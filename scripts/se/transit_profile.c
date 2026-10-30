/* Door-to-door public-transport time from many origin points to ONE hub, averaged over
 * every departure minute in a one-hour window. Driven by fetch_se_transit.py, which
 * compiles it (cc -O2) and writes its inputs; nothing else calls it.
 *
 * Routing is a profile Connection Scan (Dibbelt et al. 2018): one backward pass over the
 * day's connections, sorted by departure descending, gives every stop the Pareto set of
 * (latest departure, earliest arrival at the hub) journeys. Footpaths between stops are
 * relaxed when an entry is inserted, which is why an insertion can land out of order and
 * the per-stop lists are kept sorted rather than appended.
 *
 * Usage: transit_profile <stops.bin> <conns.bin> <job.bin> <out.bin>
 *   stops.bin  int32 n, then n × (float64 x, float64 y)            SWEREF 99 TM metres;
 *              NaN for a stop the timetable places nowhere usable (it is ridden through,
 *              never walked to)
 *   conns.bin  int32 n, int32 ntrips, then n × int32 (dep, arr, from, to, trip, flags),
 *              already sorted dep desc; flags bit0 = may board, bit1 = may alight
 *   job.bin    float64 hub_x, hub_y; int32 nt, then nt × (int32 stop, int32 walk_s);
 *              int32 np, then np × (float64 x, float64 y)
 *   out.bin    np × (float32 mean_minutes, int32 bounded_minutes)
 * A bounded minute is one where no journey reached the hub from a connection leaving by
 * the scan's end: its time is a LOWER bound (scan end − departure), and the caller decides
 * whether the mean is still exact enough to publish.
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define INF 0x3fffffff
#define WINDOW_START (8 * 3600)
#define WINDOW_MIN 60      /* departure minutes 08:00 .. 08:59 */
#define SCAN_END (14 * 3600)
#define CHANGE_S 60        /* slack when alighting and boarding another vehicle */
#define SPEED 1.25         /* walking, m/s (4.5 km/h) */
#define DETOUR 1.3         /* street distance / straight line */
#define FOOT_M 400.0       /* stop-to-stop transfer walk, straight line */
#define ACCESS_M 1500.0    /* origin-to-stop walk, straight line */
#define SLOT_S 10          /* resolution of the per-stop arrival table */

typedef struct { int dep, arr; } E;
typedef struct { E *a; int n, cap; } L;
typedef struct { int to, w; } Nb;

static void *xmalloc(size_t n) {
  void *p = malloc(n ? n : 1);
  if (!p) { fprintf(stderr, "out of memory\n"); exit(1); }
  return p;
}

static void *slurp(const char *path, size_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) { perror(path); exit(1); }
  fseek(f, 0, SEEK_END);
  *len = (size_t)ftell(f);
  fseek(f, 0, SEEK_SET);
  void *buf = xmalloc(*len);
  if (fread(buf, 1, *len, f) != *len) { perror(path); exit(1); }
  fclose(f);
  return buf;
}

static int walk_s(double d) { return (int)lround(d * DETOUR / SPEED); }

/* Entries sorted by dep descending; arr is then descending too (Pareto). */
static int eval(const L *l, int t) {
  int lo = 0, hi = l->n - 1, ans = -1;
  while (lo <= hi) {
    int m = (lo + hi) >> 1;
    if (l->a[m].dep >= t) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans < 0 ? INF : l->a[ans].arr;
}

static void insert(L *l, int d, int a) {
  if (eval(l, d) <= a) return;
  int lo = 0, hi = l->n;
  while (lo < hi) {
    int m = (lo + hi) >> 1;
    if (l->a[m].dep > d) lo = m + 1; else hi = m;
  }
  int p = lo, q = p;
  while (q < l->n && l->a[q].arr >= a) q++;
  if (q == p) {
    if (l->n == l->cap) {
      l->cap = l->cap ? l->cap * 2 : 8;
      l->a = realloc(l->a, (size_t)l->cap * sizeof(E));
      if (!l->a) { fprintf(stderr, "out of memory\n"); exit(1); }
    }
    memmove(l->a + p + 1, l->a + p, (size_t)(l->n - p) * sizeof(E));
    l->n++;
  } else if (q > p + 1) {
    memmove(l->a + p + 1, l->a + q, (size_t)(l->n - q) * sizeof(E));
    l->n -= q - p - 1;
  }
  l->a[p].dep = d;
  l->a[p].arr = a;
}

/* Square buckets over stop coordinates, for radius queries. */
typedef struct { double x0, y0, size; int nx, ny; int *start, *idx; } Grid;

static Grid grid_build(const double *xy, int n, double size) {
  Grid g = {0};
  double x0 = INFINITY, y0 = INFINITY, x1 = -INFINITY, y1 = -INFINITY;
  for (int i = 0; i < n; i++) {
    if (!isfinite(xy[2 * i]) || !isfinite(xy[2 * i + 1])) continue;
    x0 = fmin(x0, xy[2 * i]); x1 = fmax(x1, xy[2 * i]);
    y0 = fmin(y0, xy[2 * i + 1]); y1 = fmax(y1, xy[2 * i + 1]);
  }
  g.x0 = x0; g.y0 = y0; g.size = size;
  g.nx = (int)((x1 - x0) / size) + 1; g.ny = (int)((y1 - y0) / size) + 1;
  int nc = g.nx * g.ny;
  g.start = calloc((size_t)nc + 1, sizeof(int));
  g.idx = xmalloc((size_t)n * sizeof(int));
  int *cell = xmalloc((size_t)n * sizeof(int));
  for (int i = 0; i < n; i++) {
    if (!isfinite(xy[2 * i]) || !isfinite(xy[2 * i + 1])) { cell[i] = -1; continue; }
    int cx = (int)((xy[2 * i] - x0) / size), cy = (int)((xy[2 * i + 1] - y0) / size);
    cell[i] = cy * g.nx + cx;
    g.start[cell[i] + 1]++;
  }
  for (int c = 0; c < nc; c++) g.start[c + 1] += g.start[c];
  int *fill = xmalloc((size_t)nc * sizeof(int));
  memcpy(fill, g.start, (size_t)nc * sizeof(int));
  for (int i = 0; i < n; i++)
    if (cell[i] >= 0) g.idx[fill[cell[i]]++] = i;
  free(fill); free(cell);
  return g;
}

/* Stops within r of (x, y): writes (stop, walk seconds) pairs, returns the count. */
static int grid_near(const Grid *g, const double *xy, double x, double y, double r, Nb **out, int *cap) {
  int n = 0;
  int cx0 = (int)floor((x - r - g->x0) / g->size), cx1 = (int)floor((x + r - g->x0) / g->size);
  int cy0 = (int)floor((y - r - g->y0) / g->size), cy1 = (int)floor((y + r - g->y0) / g->size);
  if (cx0 < 0) cx0 = 0;
  if (cy0 < 0) cy0 = 0;
  if (cx1 >= g->nx) cx1 = g->nx - 1;
  if (cy1 >= g->ny) cy1 = g->ny - 1;
  for (int cy = cy0; cy <= cy1; cy++)
    for (int cx = cx0; cx <= cx1; cx++) {
      int c = cy * g->nx + cx;
      for (int k = g->start[c]; k < g->start[c + 1]; k++) {
        int s = g->idx[k];
        double d = hypot(xy[2 * s] - x, xy[2 * s + 1] - y);
        if (d > r) continue;
        if (n == *cap) { *cap = *cap ? *cap * 2 : 64; *out = realloc(*out, (size_t)*cap * sizeof(Nb)); }
        (*out)[n].to = s;
        (*out)[n].w = walk_s(d);
        n++;
      }
    }
  return n;
}

int main(int argc, char **argv) {
  if (argc != 5) { fprintf(stderr, "usage: %s stops.bin conns.bin job.bin out.bin\n", argv[0]); return 2; }
  size_t len;
  char *sb = slurp(argv[1], &len);
  int ns = *(int32_t *)sb;
  const double *sxy = (const double *)(sb + 8); /* python pads the header to 8 bytes */
  char *cb = slurp(argv[2], &len);
  int nc = ((int32_t *)cb)[0], ntrips = ((int32_t *)cb)[1];
  const int32_t *cn = (const int32_t *)(cb + 8);
  char *jb = slurp(argv[3], &len);
  double hx = ((double *)jb)[0], hy = ((double *)jb)[1];
  const int32_t *jt = (const int32_t *)(jb + 16);
  int nt = jt[0];
  const int32_t *targets = jt + 2; /* header padded to 8 bytes */
  const char *pp = (const char *)(targets + 2 * nt);
  int np = *(const int32_t *)pp;
  const double *pxy = (const double *)(pp + 8);

  int *tw = xmalloc((size_t)ns * sizeof(int));
  for (int i = 0; i < ns; i++) tw[i] = -1;
  for (int i = 0; i < nt; i++) tw[targets[2 * i]] = targets[2 * i + 1];

  Grid g = grid_build(sxy, ns, ACCESS_M);
  /* Footpaths, built once per run: every stop's neighbours within FOOT_M. */
  int *fstart = xmalloc(((size_t)ns + 1) * sizeof(int));
  Nb *foot = NULL, *tmp = NULL;
  int fcap = 0, fn = 0, tcap = 0;
  for (int s = 0; s < ns; s++) {
    fstart[s] = fn;
    if (!isfinite(sxy[2 * s]) || !isfinite(sxy[2 * s + 1])) continue;
    int k = grid_near(&g, sxy, sxy[2 * s], sxy[2 * s + 1], FOOT_M, &tmp, &tcap);
    for (int i = 0; i < k; i++) {
      if (tmp[i].to == s) continue;
      if (fn == fcap) { fcap = fcap ? fcap * 2 : 1 << 20; foot = realloc(foot, (size_t)fcap * sizeof(Nb)); }
      foot[fn++] = tmp[i];
    }
  }
  fstart[ns] = fn;

  L *prof = calloc((size_t)ns, sizeof(L));
  int *trip = xmalloc((size_t)ntrips * sizeof(int));
  for (int i = 0; i < ntrips; i++) trip[i] = INF;
  for (int i = 0; i < nc; i++) {
    const int32_t *c = cn + 6 * i;
    int dep = c[0], arr = c[1], from = c[2], to = c[3], tr = c[4], fl = c[5];
    int tc = trip[tr];
    if (fl & 2) {
      if (tw[to] >= 0 && arr + tw[to] < tc) tc = arr + tw[to];
      int v = eval(&prof[to], arr + CHANGE_S);
      if (v < tc) tc = v;
    }
    trip[tr] = tc;
    if ((fl & 1) && tc < INF) {
      insert(&prof[from], dep, tc);
      for (int k = fstart[from]; k < fstart[from + 1]; k++) insert(&prof[foot[k].to], dep - foot[k].w, tc);
    }
  }

  /* Arrival tables at SLOT_S resolution, built only for stops some origin can reach. */
  int nslot = (WINDOW_MIN * 60 + walk_s(ACCESS_M)) / SLOT_S + 2;
  int **table = calloc((size_t)ns, sizeof(int *));
  FILE *out = fopen(argv[4], "wb");
  if (!out) { perror(argv[4]); return 1; }
  Nb *acc = NULL;
  int acap = 0;
  for (int p = 0; p < np; p++) {
    double x = pxy[2 * p], y = pxy[2 * p + 1];
    int k = grid_near(&g, sxy, x, y, ACCESS_M, &acc, &acap);
    for (int i = 0; i < k; i++) {
      int s = acc[i].to;
      if (table[s] || prof[s].n == 0) continue;
      table[s] = xmalloc((size_t)nslot * sizeof(int));
      for (int j = 0; j < nslot; j++) table[s][j] = eval(&prof[s], WINDOW_START + j * SLOT_S);
    }
    int direct = walk_s(hypot(x - hx, y - hy));
    double sum = 0;
    int bounded = 0;
    for (int m = 0; m < WINDOW_MIN; m++) {
      int t = WINDOW_START + 60 * m, best = t + direct;
      for (int i = 0; i < k; i++) {
        int s = acc[i].to;
        if (!table[s]) continue;
        int j = (60 * m + acc[i].w + SLOT_S - 1) / SLOT_S; /* round the walk up to a slot */
        if (table[s][j] < best) best = table[s][j];
      }
      if (best > SCAN_END && t + direct > SCAN_END) {
        /* nothing reached the hub from a connection leaving by SCAN_END: a lower bound */
        bounded++;
        if (best > SCAN_END) best = SCAN_END;
      }
      sum += best - t;
    }
    float mean = (float)(sum / WINDOW_MIN / 60.0);
    fwrite(&mean, 4, 1, out);
    int32_t b = bounded;
    fwrite(&b, 4, 1, out);
  }
  fclose(out);
  return 0;
}
