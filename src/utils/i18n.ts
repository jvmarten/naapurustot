export type Lang = 'fi' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  'app.title': { fi: 'Naapurustot', en: 'Neighborhoods' },
  'app.subtitle': { fi: 'Helsingin seutu', en: 'Helsinki Metro' },
  'search.placeholder': { fi: 'Hae postinumero tai alue…', en: 'Search postal code or area…' },
  'layer.quality_index': { fi: 'Laatuindeksi', en: 'Quality Index' },
  'panel.quality_index': { fi: 'Laatuindeksi', en: 'Quality Index' },
  'layer.median_income': { fi: 'Mediaanitulo', en: 'Median Income' },
  'layer.unemployment': { fi: 'Työttömyysaste', en: 'Unemployment Rate' },
  'layer.education': { fi: 'Korkeakoulutus', en: 'Higher Education' },
  'layer.foreign_lang': { fi: 'Vieraskieliset', en: 'Foreign-Language Speakers' },
  'layer.avg_age': { fi: 'Keski-ikä', en: 'Average Age' },
  'layer.pensioners': { fi: 'Eläkeläiset', en: 'Pensioner Share' },
  'layer.noise': { fi: 'Melutaso', en: 'Noise Level' },
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
  'footer.attribution': {
    fi: 'Aineisto: Tilastokeskus (CC BY 4.0)',
    en: 'Data: Statistics Finland (CC BY 4.0)',
  },
  'layers.title': { fi: 'Aineistot', en: 'Data Layers' },
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
