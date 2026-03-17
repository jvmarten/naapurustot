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
  crime_index: number | null;
  green_space_pct: number | null;
  daycare_density: number | null;
  school_density: number | null;
  healthcare_density: number | null;
  noise_level: number | null;
  avg_building_year: number | null;
  energy_efficiency: number | null;
  population_growth_pct: number | null;
  gini_coefficient: number | null;
  single_person_hh_pct: number | null;
  seniors_alone_pct: number | null;
  cars_per_household: number | null;
  cycling_density: number | null;
  avg_commute_min: number | null;
  restaurant_density: number | null;
  grocery_density: number | null;
  walkability_index: number | null;
  kela_benefit_pct: number | null;
  rental_price_sqm: number | null;
  avg_taxable_income: number | null;
  obesity_rate: number | null;
  life_expectancy: number | null;
  school_quality_score: number | null;
  median_household_debt: number | null;
  price_to_rent_ratio: number | null;
  light_pollution: number | null;
  mental_health_pct: number | null;
  net_migration_pct: number | null;
  avg_residency_years: number | null;
  traffic_accident_density: number | null;
  // Historical time-series data (JSON-encoded arrays of [year, value] pairs)
  income_history: string | null;
  population_history: string | null;
  unemployment_history: string | null;
  [key: string]: string | number | null;
}

/** A single data point in a time series: [year, value] */
export type TrendDataPoint = [number, number];

/** Parse a JSON-encoded trend series from GeoJSON properties */
export function parseTrendSeries(raw: string | null | undefined): TrendDataPoint[] | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return parsed as TrendDataPoint[];
    }
  } catch {
    // invalid JSON
  }
  return null;
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
  let totalCrimeIndex = 0;
  let crimeIndexCount = 0;
  let totalGreenSpace = 0;
  let greenSpaceCount = 0;
  let totalDaycare = 0;
  let daycareCount = 0;
  let totalSchool = 0;
  let schoolCount = 0;
  let totalHealthcare = 0;
  let healthcareCount = 0;
  let totalNoise = 0;
  let noiseCount = 0;
  let totalBuildingYear = 0;
  let buildingYearCount = 0;
  let totalEnergy = 0;
  let energyCount = 0;
  let totalPopGrowth = 0;
  let popGrowthCount = 0;
  let totalGini = 0;
  let giniCount = 0;
  let totalSingleHh = 0;
  let singleHhTotal = 0;
  let totalSeniorsAlone = 0;
  let seniorsAloneCount = 0;
  let totalCars = 0;
  let carsCount = 0;
  let totalCycling = 0;
  let cyclingCount = 0;
  let totalCommute = 0;
  let commuteCount = 0;
  let totalRestaurant = 0;
  let restaurantCount = 0;
  let totalGrocery = 0;
  let groceryCount = 0;
  let totalWalkability = 0;
  let walkabilityCount = 0;
  let totalKela = 0;
  let kelaCount = 0;
  let totalRentalPrice = 0;
  let rentalPriceCount = 0;
  let totalTaxIncome = 0;
  let taxIncomeCount = 0;
  let totalObesity = 0;
  let obesityCount = 0;
  let totalLifeExp = 0;
  let lifeExpCount = 0;
  let totalSchoolQuality = 0;
  let schoolQualityCount = 0;
  let totalHhDebt = 0;
  let hhDebtCount = 0;
  let totalPtrRatio = 0;
  let ptrCount = 0;
  let totalLightPollution = 0;
  let lightPollutionCount = 0;
  let totalMentalHealth = 0;
  let mentalHealthCount = 0;
  let totalNetMigration = 0;
  let netMigrationCount = 0;
  let totalResidency = 0;
  let residencyCount = 0;
  let totalTrafficAccidents = 0;
  let trafficAccidentsCount = 0;

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
      if (p.crime_index != null) {
        totalCrimeIndex += p.crime_index * pop;
        crimeIndexCount += pop;
      }
      if (p.green_space_pct != null) {
        totalGreenSpace += p.green_space_pct * pop;
        greenSpaceCount += pop;
      }
      if (p.daycare_density != null) {
        totalDaycare += p.daycare_density * pop;
        daycareCount += pop;
      }
      if (p.school_density != null) {
        totalSchool += p.school_density * pop;
        schoolCount += pop;
      }
      if (p.healthcare_density != null) {
        totalHealthcare += p.healthcare_density * pop;
        healthcareCount += pop;
      }
      if (p.noise_level != null) {
        totalNoise += p.noise_level * pop;
        noiseCount += pop;
      }
      if (p.avg_building_year != null) {
        totalBuildingYear += p.avg_building_year * pop;
        buildingYearCount += pop;
      }
      if (p.energy_efficiency != null) {
        totalEnergy += p.energy_efficiency * pop;
        energyCount += pop;
      }
      if (p.population_growth_pct != null) {
        totalPopGrowth += p.population_growth_pct * pop;
        popGrowthCount += pop;
      }
      if (p.gini_coefficient != null) {
        totalGini += p.gini_coefficient * pop;
        giniCount += pop;
      }
      if (p.single_person_hh_pct != null && p.te_taly != null) {
        totalSingleHh += (p.single_person_hh_pct / 100) * p.te_taly;
        singleHhTotal += p.te_taly;
      }
      if (p.seniors_alone_pct != null) {
        totalSeniorsAlone += p.seniors_alone_pct * pop;
        seniorsAloneCount += pop;
      }
      if (p.cars_per_household != null) {
        totalCars += p.cars_per_household * pop;
        carsCount += pop;
      }
      if (p.cycling_density != null) {
        totalCycling += p.cycling_density * pop;
        cyclingCount += pop;
      }
      if (p.avg_commute_min != null) {
        totalCommute += p.avg_commute_min * pop;
        commuteCount += pop;
      }
      if (p.restaurant_density != null) {
        totalRestaurant += p.restaurant_density * pop;
        restaurantCount += pop;
      }
      if (p.grocery_density != null) {
        totalGrocery += p.grocery_density * pop;
        groceryCount += pop;
      }
      if (p.walkability_index != null) {
        totalWalkability += p.walkability_index * pop;
        walkabilityCount += pop;
      }
      if (p.kela_benefit_pct != null) {
        totalKela += p.kela_benefit_pct * pop;
        kelaCount += pop;
      }
      if (p.rental_price_sqm != null) {
        totalRentalPrice += p.rental_price_sqm * pop;
        rentalPriceCount += pop;
      }
      if (p.avg_taxable_income != null && p.avg_taxable_income > 0) {
        totalTaxIncome += p.avg_taxable_income * pop;
        taxIncomeCount += pop;
      }
      if (p.obesity_rate != null) {
        totalObesity += p.obesity_rate * pop;
        obesityCount += pop;
      }
      if (p.life_expectancy != null) {
        totalLifeExp += p.life_expectancy * pop;
        lifeExpCount += pop;
      }
      if (p.school_quality_score != null) {
        totalSchoolQuality += p.school_quality_score * pop;
        schoolQualityCount += pop;
      }
      if (p.median_household_debt != null) {
        totalHhDebt += p.median_household_debt * pop;
        hhDebtCount += pop;
      }
      if (p.price_to_rent_ratio != null) {
        totalPtrRatio += p.price_to_rent_ratio * pop;
        ptrCount += pop;
      }
      if (p.light_pollution != null) {
        totalLightPollution += p.light_pollution * pop;
        lightPollutionCount += pop;
      }
      if (p.mental_health_pct != null) {
        totalMentalHealth += p.mental_health_pct * pop;
        mentalHealthCount += pop;
      }
      if (p.net_migration_pct != null) {
        totalNetMigration += p.net_migration_pct * pop;
        netMigrationCount += pop;
      }
      if (p.avg_residency_years != null) {
        totalResidency += p.avg_residency_years * pop;
        residencyCount += pop;
      }
      if (p.traffic_accident_density != null) {
        totalTrafficAccidents += p.traffic_accident_density * pop;
        trafficAccidentsCount += pop;
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
    crime_index: crimeIndexCount > 0 ? Math.round((totalCrimeIndex / crimeIndexCount) * 10) / 10 : 0,
    green_space_pct: greenSpaceCount > 0 ? Math.round((totalGreenSpace / greenSpaceCount) * 10) / 10 : 0,
    daycare_density: daycareCount > 0 ? Math.round((totalDaycare / daycareCount) * 10) / 10 : 0,
    school_density: schoolCount > 0 ? Math.round((totalSchool / schoolCount) * 10) / 10 : 0,
    healthcare_density: healthcareCount > 0 ? Math.round((totalHealthcare / healthcareCount) * 10) / 10 : 0,
    noise_level: noiseCount > 0 ? Math.round((totalNoise / noiseCount) * 10) / 10 : 0,
    avg_building_year: buildingYearCount > 0 ? Math.round(totalBuildingYear / buildingYearCount) : 0,
    energy_efficiency: energyCount > 0 ? Math.round((totalEnergy / energyCount) * 10) / 10 : 0,
    population_growth_pct: popGrowthCount > 0 ? Math.round((totalPopGrowth / popGrowthCount) * 10) / 10 : 0,
    gini_coefficient: giniCount > 0 ? Math.round((totalGini / giniCount) * 100) / 100 : 0,
    single_person_hh_pct: singleHhTotal > 0 ? Math.round((totalSingleHh / singleHhTotal) * 1000) / 10 : 0,
    seniors_alone_pct: seniorsAloneCount > 0 ? Math.round((totalSeniorsAlone / seniorsAloneCount) * 10) / 10 : 0,
    cars_per_household: carsCount > 0 ? Math.round((totalCars / carsCount) * 100) / 100 : 0,
    cycling_density: cyclingCount > 0 ? Math.round((totalCycling / cyclingCount) * 10) / 10 : 0,
    avg_commute_min: commuteCount > 0 ? Math.round(totalCommute / commuteCount) : 0,
    restaurant_density: restaurantCount > 0 ? Math.round((totalRestaurant / restaurantCount) * 10) / 10 : 0,
    grocery_density: groceryCount > 0 ? Math.round((totalGrocery / groceryCount) * 10) / 10 : 0,
    walkability_index: walkabilityCount > 0 ? Math.round((totalWalkability / walkabilityCount) * 10) / 10 : 0,
    kela_benefit_pct: kelaCount > 0 ? Math.round((totalKela / kelaCount) * 10) / 10 : 0,
    rental_price_sqm: rentalPriceCount > 0 ? Math.round((totalRentalPrice / rentalPriceCount) * 100) / 100 : 0,
    avg_taxable_income: taxIncomeCount > 0 ? Math.round(totalTaxIncome / taxIncomeCount) : 0,
    obesity_rate: obesityCount > 0 ? Math.round((totalObesity / obesityCount) * 10) / 10 : 0,
    life_expectancy: lifeExpCount > 0 ? Math.round((totalLifeExp / lifeExpCount) * 10) / 10 : 0,
    school_quality_score: schoolQualityCount > 0 ? Math.round((totalSchoolQuality / schoolQualityCount) * 10) / 10 : 0,
    median_household_debt: hhDebtCount > 0 ? Math.round(totalHhDebt / hhDebtCount) : 0,
    price_to_rent_ratio: ptrCount > 0 ? Math.round((totalPtrRatio / ptrCount) * 10) / 10 : 0,
    light_pollution: lightPollutionCount > 0 ? Math.round((totalLightPollution / lightPollutionCount) * 10) / 10 : 0,
    mental_health_pct: mentalHealthCount > 0 ? Math.round((totalMentalHealth / mentalHealthCount) * 10) / 10 : 0,
    net_migration_pct: netMigrationCount > 0 ? Math.round((totalNetMigration / netMigrationCount) * 10) / 10 : 0,
    avg_residency_years: residencyCount > 0 ? Math.round((totalResidency / residencyCount) * 10) / 10 : 0,
    traffic_accident_density: trafficAccidentsCount > 0 ? Math.round((totalTrafficAccidents / trafficAccidentsCount) * 10) / 10 : 0,
  };
}
