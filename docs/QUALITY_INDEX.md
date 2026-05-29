# The naapurustot.fi Quality Index

> Methodology for the headline **Quality Index** — the default map layer and the
> first number every visitor sees. This document explains how it is computed,
> why each weight was chosen, and where it is deliberately conservative.
>
> **This methodology and its category wording are open to editorial revision.**
> The choices below are defensible defaults, not the last word.

## Why the index was redesigned (CF-1)

The original index was a flat, hand-tuned blend of seven factors:

| Factor | Old weight |
|--------|-----------:|
| Safety (crime) | 25 |
| Income | 20 |
| Employment | 20 |
| Education | 15 |
| Transit | 7 |
| Services | 5 |
| Air quality | 3 |

Income, employment, education and crime are all strong proxies for area
**affluence** — they are highly correlated in Finnish neighborhood data. With
the old weights, roughly **80 %** of the score was effectively *one* latent
variable (socioeconomic status) counted four times over. The "Quality Index"
was, in practice, an affluence map relabelled: analytically weak and
editorially loaded, since it quietly stigmatized lower-income areas while
telling users little they couldn't read straight off the income layer.

## The dimension model

The ~50 available factors are grouped into **six conceptual dimensions**. Each
dimension is scored once, and dimensions are weighted — so each concept counts
once and genuine liveability factors (services, mobility, environment) actually
register.

| Dimension | Default weight | Factors (default) | OECD / Eurostat anchor |
|-----------|---------------:|--------------------|------------------------|
| **Prosperity** | 30 | Income, employment, education (counted **once**, 10 each) | OECD *Income & Wealth*, *Jobs*, *Education* |
| **Safety** | 18 | Crime rate | OECD *Safety* |
| **Services & amenities** | 18 | Healthcare, school, daycare, grocery density | Eurostat *Access to services* |
| **Mobility** | 17 | Transit stop density | OECD/Eurostat *Accessibility* |
| **Environment** | 17 | Air quality | OECD *Environmental quality* |
| **Housing context** | 0 | (descriptive — see below) | OECD *Housing* |

The weights sum to 100 across the five evaluative dimensions and are anchored to
the **OECD Better Life Index** and **Eurostat Quality-of-Life** frameworks,
which both treat material conditions, safety, services, accessibility and
environment as distinct, comparably-weighted dimensions of well-being.

### How dimension scoring is implemented

`computeQualityIndices` uses a weighted average of per-factor normalized scores.
Because the default factor weights within a dimension **sum to that dimension's
target weight** (e.g. Prosperity = income 10 + employment 10 + education 10 =
30), this is mathematically equivalent to scoring each dimension once and then
weighting the dimensions. Grouping income/employment/education into a single
Prosperity dimension is exactly what removes the multiple-counting: socioeconomic
status now contributes **30 %** (Prosperity) + **18 %** (Safety) ≈ 48 %, down
from ~80 %, leaving real room for services (18), mobility (17) and environment (17).

### Housing & demographics

Housing metrics (price, ownership rate, apartment size) and demographic /
sectoral / civic metrics have **no objective "better" direction** — a high rental
share or a young population is a preference, not a quality. They are therefore
**descriptive** (default weight 0) and never inflate or deflate the default
score, though users can opt them in via custom weights.

## Persona presets

`CustomQualityPanel` ships six named lenses (cloud-synced via the existing
preferences sync):

| Persona | Emphasis |
|---------|----------|
| **Default** (the out-of-the-box index) | The OECD-anchored weighting in the table above — Prosperity leans a little heavier (30). |
| **Balanced** | Every evaluative dimension weighted *exactly equally* (20 each) — distinct from Default. |
| **Family with children** | Services, safety, education |
| **Young professional (car-free)** | Mobility (transit/cycling/walking), services, prosperity |
| **Student** | Mobility, services, quiet |
| **Retiree** | Safety, healthcare services, clean & quiet environment |
| **Nature & quiet** | Environment, green space, low noise |

"Default" and "Balanced" are deliberately separate: the default is opinionated
(material conditions weigh somewhat more, per OECD), while "Balanced" is the
neutral all-equal lens for users who want no built-in emphasis.

Personas are just weight presets — users can fine-tune any factor afterwards,
and a "How is this calculated?" popover on the Quality badge lists the active
dimensions and weights.

## Category labels

The 0–100 score maps to five directional bands (colors unchanged):

| Range | Label |
|-------|-------|
| 0–20 | Avoid |
| 20–40 | Bad |
| 40–60 | Okay |
| 60–80 | Good |
| 80–100 | Excellent |

## Normalization (current & planned)

Each metric is currently **min–max normalized over the loaded area**, with the
existing *comparison scope* toggle letting users switch between the whole loaded
view and a single region. A consequence is that a score's meaning shifts when
you switch regions — the best postal code in a small region can score ~100 just
like the best in Helsinki.

**Planned (CF-1 phase C):** compute fixed **national percentile breakpoints**
once at build time over all ~3 018 postal codes, store them as a data artifact,
and normalize against them so "72" means the same everywhere — keeping the
"within region" toggle as an explicit opt-in. This change alters the meaning of
every published score and is the part of CF-1 that most warrants editorial
review before release; it is intentionally **not yet enabled by default**.

## Data sources

Every factor traces to a real source — Statistics Finland (Paavo), HSL/HSY,
Helsinki Region Infoshare, OpenStreetMap, and the per-metric attributions shown
in the neighborhood panel. No values are fabricated or interpolated as
placeholders.
