export type Lang = 'fi' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  'app.title': { fi: 'Naapurustot', en: 'Neighborhoods' },
  'app.subtitle': { fi: 'Helsingin seutu', en: 'Helsinki Metro' },
  'search.placeholder': { fi: 'Hae postinumero tai alue…', en: 'Search postal code or area…' },
  'search.moreResults': { fi: 'tulosta lisää…', en: 'more results…' },
  'layer.quality_index': { fi: 'Laatuindeksi', en: 'Quality Index' },
  'panel.quality_index': { fi: 'Laatuindeksi', en: 'Quality Index' },
  'layer.median_income': { fi: 'Mediaanitulo', en: 'Median Income' },
  'layer.unemployment': { fi: 'Työttömyysaste', en: 'Unemployment Rate' },
  'layer.education': { fi: 'Korkeakoulutus', en: 'Higher Education' },
  'layer.foreign_lang': { fi: 'Vieraskieliset', en: 'Foreign-Language Speakers' },
  'layer.avg_age': { fi: 'Keski-ikä', en: 'Average Age' },
  'layer.pensioners': { fi: 'Eläkeläiset', en: 'Pensioner Share' },
  'layer.ownership': { fi: 'Omistusasuminen', en: 'Home Ownership' },
  'layer.rental': { fi: 'Vuokra-asuminen', en: 'Rental Rate' },
  'layer.apt_size': { fi: 'Asunnon koko', en: 'Avg. Apartment Size' },
  'layer.detached_houses': { fi: 'Omakotitalot', en: 'Detached Houses' },
  'layer.student_share': { fi: 'Opiskelijat', en: 'Student Share' },
  'layer.population_density': { fi: 'Väestötiheys', en: 'Population Density' },
  'layer.child_ratio': { fi: 'Lapsiperheet', en: 'Young Children (0-6)' },
  'layer.property_price': { fi: 'Asuntohinnat', en: 'Property Prices' },
  'layer.transit_access': { fi: 'Joukkoliikenne', en: 'Transit Access' },
  'layer.air_quality': { fi: 'Ilmanlaatu', en: 'Air Quality' },
  'layer.crime_rate': { fi: 'Rikollisuus', en: 'Crime Rate' },
  'layer.noise_level': { fi: 'Melutaso', en: 'Noise Level' },
  'layer.green_space': { fi: 'Viheralueet', en: 'Green Spaces' },
  'layer.daycare_density': { fi: 'Päiväkodit', en: 'Daycare Density' },
  'layer.school_density': { fi: 'Koulut', en: 'School Density' },
  'layer.healthcare_access': { fi: 'Terveyspalvelut', en: 'Healthcare Access' },
  'layer.building_age': { fi: 'Rakennusten ikä', en: 'Building Age' },
  'layer.energy_class': { fi: 'Energialuokka', en: 'Energy Efficiency' },
  'layer.population_growth': { fi: 'Väestönkasvu', en: 'Population Growth' },
  'layer.income_inequality': { fi: 'Tuloeroindeksi', en: 'Income Inequality' },
  'layer.single_person_hh': { fi: 'Yksinasuvat', en: 'Single-Person HH' },
  'layer.seniors_alone': { fi: 'Yksinasuvat seniorit', en: 'Seniors Living Alone' },
  'layer.car_ownership': { fi: 'Autoistuminen', en: 'Car Ownership' },
  'layer.cycling_infra': { fi: 'Pyöräilyinfra', en: 'Cycling Infrastructure' },
  'layer.commute_time': { fi: 'Työmatka-aika', en: 'Commute Time' },
  'layer.restaurant_density': { fi: 'Ravintolat & kahvilat', en: 'Restaurants & Cafes' },
  'layer.grocery_access': { fi: 'Ruokakaupat', en: 'Grocery Stores' },

  // Panel labels
  'panel.population': { fi: 'Väestö', en: 'Population' },
  'panel.median_income': { fi: 'Mediaanitulo', en: 'Median Income' },
  'panel.avg_income': { fi: 'Keskitulo', en: 'Average Income' },
  'panel.unemployment': { fi: 'Työttömyysaste', en: 'Unemployment Rate' },
  'panel.education': { fi: 'Koulutusjakauma', en: 'Education Breakdown' },
  'panel.higher_edu': { fi: 'Ylempi korkeakoulu', en: "Master's+" },
  'panel.bachelor': { fi: 'Alempi korkeakoulu', en: "Bachelor's" },
  'panel.vocational': { fi: 'Ammattikoulutus', en: 'Vocational' },
  'panel.basic': { fi: 'Peruskoulu', en: 'Basic Education' },
  'panel.foreign_lang': { fi: 'Vieraskieliset', en: 'Foreign-Language Speakers' },
  'panel.employed': { fi: 'Työlliset', en: 'Employed' },
  'panel.unemployed': { fi: 'Työttömät', en: 'Unemployed' },
  'panel.students': { fi: 'Opiskelijat', en: 'Students' },
  'panel.pensioners': { fi: 'Eläkeläiset', en: 'Pensioners' },
  'panel.dwellings': { fi: 'Asuntoja', en: 'Dwellings' },
  'panel.households': { fi: 'Talouksia', en: 'Households' },
  'panel.vs_metro': { fi: 'vs. seutu', en: 'vs. metro' },
  'panel.age_distribution': { fi: 'Ikäjakauma', en: 'Age Distribution' },

  // New panel labels for Phase 1 & 2 metrics
  'panel.housing': { fi: 'Asuminen', en: 'Housing' },
  'panel.ownership_rate': { fi: 'Omistusaste', en: 'Ownership Rate' },
  'panel.rental_rate': { fi: 'Vuokra-aste', en: 'Rental Rate' },
  'panel.avg_apt_size': { fi: 'Asunnon koko (ka.)', en: 'Avg. Apt. Size' },
  'panel.detached_houses': { fi: 'Omakotitalot', en: 'Detached Houses' },
  'panel.demographics': { fi: 'Väestörakenne', en: 'Demographics' },
  'panel.population_density': { fi: 'Väestötiheys', en: 'Pop. Density' },
  'panel.child_ratio': { fi: 'Lapset (0-6)', en: 'Children (0-6)' },
  'panel.student_share': { fi: 'Opiskelijaosuus', en: 'Student Share' },
  'panel.quality_of_life': { fi: 'Elämänlaatu', en: 'Quality of Life' },
  'panel.property_price': { fi: 'Asuntohinta (€/m²)', en: 'Property Price (€/m²)' },
  'panel.transit_access': { fi: 'Pysäkkitiheys', en: 'Transit Stop Density' },
  'panel.air_quality': { fi: 'Ilmanlaatu', en: 'Air Quality Index' },
  'panel.crime_rate': { fi: 'Rikoksia / 1000 as.', en: 'Crimes / 1000 res.' },

  // New panel labels for Phase 3 metrics
  'panel.green_space': { fi: 'Viheralueet (/km²)', en: 'Green Spaces (/km²)' },
  'panel.daycare_density': { fi: 'Päiväkodit (/km²)', en: 'Daycares (/km²)' },
  'panel.school_density': { fi: 'Koulut (/km²)', en: 'Schools (/km²)' },
  'panel.healthcare_access': { fi: 'Terveyspalvelut (/km²)', en: 'Healthcare (/km²)' },
  'panel.noise_level': { fi: 'Melutaso (dB)', en: 'Noise Level (dB)' },
  'panel.building_age': { fi: 'Rakennusten keski-ikä', en: 'Avg. Building Year' },
  'panel.energy_class': { fi: 'Energialuokka', en: 'Energy Class' },
  'panel.population_growth': { fi: 'Väestönkasvu (%)', en: 'Pop. Growth (%)' },
  'panel.income_inequality': { fi: 'Gini-kerroin', en: 'Gini Coefficient' },
  'panel.single_person_hh': { fi: 'Yksinasuvat (%)', en: 'Single-Person HH (%)' },
  'panel.seniors_alone': { fi: 'Yksinasuvat 65+ (%)', en: 'Seniors Alone (%)' },
  'panel.car_ownership': { fi: 'Autoja / talous', en: 'Cars / Household' },
  'panel.cycling_infra': { fi: 'Pyöräilyinfra (/km²)', en: 'Cycling Infra (/km²)' },
  'panel.commute_time': { fi: 'Työmatka-aika (min)', en: 'Commute Time (min)' },
  'panel.restaurant_density': { fi: 'Ravintolat (/km²)', en: 'Restaurants (/km²)' },
  'panel.grocery_access': { fi: 'Ruokakaupat (/km²)', en: 'Groceries (/km²)' },

  // Layer group headers
  'layers.title': { fi: 'Aineistot', en: 'Data Layers' },
  'layers.demographics': { fi: 'Väestö', en: 'Demographics' },
  'layers.economy': { fi: 'Talous', en: 'Economy' },
  'layers.housing': { fi: 'Asuminen', en: 'Housing' },
  'layers.quality': { fi: 'Elämänlaatu', en: 'Quality of Life' },
  'layers.services': { fi: 'Palvelut', en: 'Services' },
  'layers.environment': { fi: 'Ympäristö', en: 'Environment' },
  'layers.mobility': { fi: 'Liikkuminen', en: 'Mobility' },

  'error.load_failed': {
    fi: 'Aluetietojen lataaminen epäonnistui',
    en: 'Failed to load neighborhood data',
  },
  'error.retry': { fi: 'Yritä uudelleen', en: 'Try again' },
  'loading.title': { fi: 'Ladataan aluetietoja…', en: 'Loading neighborhood data…' },

  'ranking.title': { fi: 'Alueet järjestyksessä', en: 'Neighborhood Ranking' },
  'ranking.no_data': { fi: 'Ei tietoja', en: 'No data available' },
  'ranking.areas': { fi: 'aluetta', en: 'areas' },
  'ranking.toggle': { fi: 'Ranking', en: 'Ranking' },
  'ranking.best_first': { fi: 'Paras ensin', en: 'Best first' },
  'ranking.worst_first': { fi: 'Heikoin ensin', en: 'Worst first' },

  'export.csv': { fi: 'Lataa CSV', en: 'Export CSV' },
  'export.pdf': { fi: 'Lataa PDF', en: 'Export PDF' },
  'export.field': { fi: 'Kenttä', en: 'Field' },
  'export.value': { fi: 'Arvo', en: 'Value' },

  'footer.attribution': {
    fi: 'Aineisto: Tilastokeskus, HSL, HSY, Poliisi, OpenStreetMap (CC BY 4.0)',
    en: 'Data: Statistics Finland, HSL, HSY, Police, OpenStreetMap (CC BY 4.0)',
  },

  // Comparison panel
  'compare.title': { fi: 'Vertailu', en: 'Comparison' },
  'compare.pin': { fi: 'Lisää vertailuun', en: 'Add to comparison' },
  'compare.pinned': { fi: 'Vertailussa', en: 'Pinned' },
  'compare.clear': { fi: 'Tyhjennä', en: 'Clear all' },
  'compare.max': { fi: 'Enintään 3 aluetta', en: 'Max 3 areas' },
  'compare.best': { fi: 'Paras', en: 'Best' },
};

let currentLang: Lang = 'fi';

export function setLang(lang: Lang) {
  currentLang = lang;
}

export function getLang(): Lang {
  return currentLang;
}

export function t(key: string): string {
  return translations[key]?.[currentLang] ?? key;
}
