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
  pt_vakiy: number | null;
  pt_elak: number | null;
  ra_asunn: number | null;
  ra_as_kpa: number | null;
  ra_pt_as: number | null;
  te_takk: number | null;
  te_taly: number | null;
  te_omis_as: number | null;
  te_vuok_as: number | null;
  pinta_ala: number | null;
  he_0_2: number | null;
  he_3_6: number | null;
  unemployment_rate: number | null;
  higher_education_rate: number | null;
  pensioner_share: number | null;
  foreign_language_pct: number | null;
  quality_index: number | null;
  ownership_rate: number | null;
  rental_rate: number | null;
  population_density: number | null;
  child_ratio: number | null;
  student_share: number | null;
  detached_house_share: number | null;
  property_price_sqm: number | null;
  transit_stop_density: number | null;
  air_quality_index: number | null;
  [key: string]: string | number | null;
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
  let totalOwnerOcc = 0;
  let totalHouseholds = 0;
  let totalRental = 0;
  let totalAptSize = 0;
  let aptSizeCount = 0;
  let totalStudents = 0;
  let totalActPop = 0;
  let totalChildren = 0;
  let totalArea = 0;
  let totalDetached = 0;
  let totalDwellings = 0;
  let totalPropertyPrice = 0;
  let propertyPriceCount = 0;
  let totalTransitDensity = 0;
  let transitCount = 0;
  let totalAirQuality = 0;
  let airQualityCount = 0;

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
      if (p.te_omis_as != null) totalOwnerOcc += p.te_omis_as;
      if (p.te_taly != null) totalHouseholds += p.te_taly;
      if (p.te_vuok_as != null) totalRental += p.te_vuok_as;
      if (p.ra_as_kpa != null && p.ra_as_kpa > 0) {
        totalAptSize += p.ra_as_kpa * pop;
        aptSizeCount += pop;
      }
      if (p.pt_opisk != null) totalStudents += p.pt_opisk;
      if (p.pt_vakiy != null) totalActPop += p.pt_vakiy;
      else totalActPop += pop;
      if (p.he_0_2 != null) totalChildren += p.he_0_2;
      if (p.he_3_6 != null) totalChildren += p.he_3_6;
      if (p.pinta_ala != null) totalArea += p.pinta_ala;
      if (p.ra_pt_as != null) totalDetached += p.ra_pt_as;
      if (p.ra_asunn != null) totalDwellings += p.ra_asunn;
      if (p.property_price_sqm != null && p.property_price_sqm > 0) {
        totalPropertyPrice += p.property_price_sqm * pop;
        propertyPriceCount += pop;
      }
      if (p.transit_stop_density != null) {
        totalTransitDensity += p.transit_stop_density * pop;
        transitCount += pop;
      }
      if (p.air_quality_index != null) {
        totalAirQuality += p.air_quality_index * pop;
        airQualityCount += pop;
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
    ownership_rate: totalHouseholds > 0 ? Math.round((totalOwnerOcc / totalHouseholds) * 1000) / 10 : 0,
    rental_rate: totalHouseholds > 0 ? Math.round((totalRental / totalHouseholds) * 1000) / 10 : 0,
    ra_as_kpa: aptSizeCount > 0 ? Math.round((totalAptSize / aptSizeCount) * 10) / 10 : 0,
    student_share: totalActPop > 0 ? Math.round((totalStudents / totalActPop) * 1000) / 10 : 0,
    population_density: totalArea > 0 ? Math.round(totalPop / (totalArea / 1_000_000)) : 0,
    child_ratio: totalPop > 0 ? Math.round((totalChildren / totalPop) * 1000) / 10 : 0,
    detached_house_share: totalDwellings > 0 ? Math.round((totalDetached / totalDwellings) * 1000) / 10 : 0,
    property_price_sqm: propertyPriceCount > 0 ? Math.round(totalPropertyPrice / propertyPriceCount) : 0,
    transit_stop_density: transitCount > 0 ? Math.round((totalTransitDensity / transitCount) * 10) / 10 : 0,
    air_quality_index: airQualityCount > 0 ? Math.round((totalAirQuality / airQualityCount) * 10) / 10 : 0,
  };
}
