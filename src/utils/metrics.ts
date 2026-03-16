export interface NeighborhoodProperties {
  pno: string;
  nimi: string;
  namn: string;
  he_vakiy: number | null;
  he_kika: number | null;
  ko_ika18y: number | null;
  ko_yl_kork: number | null;
  ko_al_kork: number | null;
  ko_ammat: number | null;
  ko_perus: number | null;
  hr_mtu: number | null;
  hr_ktu: number | null;
  pt_tyoll: number | null;
  pt_tyott: number | null;
  pt_opisk: number | null;
  pt_elak: number | null;
  ra_asunn: number | null;
  te_takk: number | null;
  unemployment_rate: number | null;
  higher_education_rate: number | null;
  pensioner_share: number | null;
  foreign_language_pct: number | null;
  quality_index: number | null;
  [key: string]: any;
}

export function computeMetroAverages(features: GeoJSON.Feature[]): Record<string, number> {
  let totalPop = 0;
  let totalIncome = 0;
  let incomeCount = 0;
  let totalUnemployed = 0;
  let totalHigherEd = 0;
  let totalAdultPop = 0;
  let totalForeignLang = 0;
  let foreignLangCount = 0;

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    const pop = p.he_vakiy;
    if (pop != null && pop > 0) {
      totalPop += pop;
      if (p.hr_mtu != null && p.hr_mtu > 0) {
        totalIncome += p.hr_mtu * pop;
        incomeCount += pop;
      }
      if (p.pt_tyott != null) totalUnemployed += p.pt_tyott;
      if (p.ko_yl_kork != null) totalHigherEd += p.ko_yl_kork;
      if (p.ko_al_kork != null) totalHigherEd += p.ko_al_kork;
      if (p.ko_ika18y != null) totalAdultPop += p.ko_ika18y;
      if (p.foreign_language_pct != null) {
        totalForeignLang += (p.foreign_language_pct / 100) * pop;
        foreignLangCount += pop;
      }
    }
  }

  return {
    hr_mtu: incomeCount > 0 ? Math.round(totalIncome / incomeCount) : 0,
    unemployment_rate: totalPop > 0 ? Math.round((totalUnemployed / totalPop) * 1000) / 10 : 0,
    higher_education_rate:
      totalAdultPop > 0 ? Math.round((totalHigherEd / totalAdultPop) * 1000) / 10 : 0,
    foreign_language_pct:
      foreignLangCount > 0
        ? Math.round((totalForeignLang / foreignLangCount) * 1000) / 10
        : 0,
    he_vakiy: totalPop,
  };
}
