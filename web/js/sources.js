// Wissenschaftliche und offizielle Quellen, auf die sich Berechnungen und Tipps stützen.
export const SOURCES = {
  banister: {
    short: "Morton, Fitz-Clarke & Banister 1990",
    title: "Modeling human performance in running. Journal of Applied Physiology 69(3), 1171–1177",
    url: "https://doi.org/10.1152/jappl.1990.69.3.1171",
  },
  tanaka: {
    short: "Tanaka et al. 2001",
    title: "Age-predicted maximal heart rate revisited. Journal of the American College of Cardiology 37(1), 153–156",
    url: "https://doi.org/10.1016/S0735-1097(00)01054-8",
  },
  seiler: {
    short: "Seiler 2010",
    title: "What is best practice for training intensity and duration distribution in endurance athletes? International Journal of Sports Physiology and Performance 5(3), 276–291",
    url: "https://doi.org/10.1123/ijspp.5.3.276",
  },
  gabbett: {
    short: "Gabbett 2016",
    title: "The training–injury prevention paradox. British Journal of Sports Medicine 50(5), 273–280",
    url: "https://doi.org/10.1136/bjsports-2015-095788",
  },
  foster: {
    short: "Foster 1998",
    title: "Monitoring training in athletes with reference to overtraining syndrome. Medicine & Science in Sports & Exercise 30(7), 1164–1168",
    url: "https://pubmed.ncbi.nlm.nih.gov/?term=Foster+1998+Monitoring+training+in+athletes+with+reference+to+overtraining+syndrome",
  },
  plews: {
    short: "Plews et al. 2013",
    title: "Training adaptation and heart rate variability in elite endurance athletes. Sports Medicine 43(9), 773–781",
    url: "https://doi.org/10.1007/s40279-013-0071-8",
  },
  helgerud: {
    short: "Helgerud et al. 2007",
    title: "Aerobic high-intensity intervals improve VO2max more than moderate training. Medicine & Science in Sports & Exercise 39(4), 665–671",
    url: "https://pubmed.ncbi.nlm.nih.gov/?term=Helgerud+2007+Aerobic+high-intensity+intervals+improve+VO2max",
  },
  bosquet: {
    short: "Bosquet et al. 2007",
    title: "Effects of tapering on performance: a meta-analysis. Medicine & Science in Sports & Exercise 39(8), 1358–1365",
    url: "https://pubmed.ncbi.nlm.nih.gov/?term=Bosquet+2007+Effects+of+tapering+on+performance+meta-analysis",
  },
  who: {
    short: "WHO 2020",
    title: "WHO guidelines on physical activity and sedentary behaviour. Weltgesundheitsorganisation, Genf",
    url: "https://www.who.int/publications/i/item/9789240015128",
  },
  sleep: {
    short: "Watson et al. 2015 (AASM/SRS)",
    title: "Recommended Amount of Sleep for a Healthy Adult. Konsenserklärung der American Academy of Sleep Medicine und Sleep Research Society, Sleep 38(6), 843–844",
    url: "https://doi.org/10.5665/sleep.4716",
  },
  radin: {
    short: "Radin et al. 2020",
    title: "Harnessing wearable device data to improve state-level real-time surveillance of influenza-like illness in the USA. The Lancet Digital Health 2(2), e85–e93",
    url: "https://doi.org/10.1016/S2589-7500(19)30222-5",
  },
  mishra: {
    short: "Mishra et al. 2020",
    title: "Pre-symptomatic detection of COVID-19 from smartwatch data. Nature Biomedical Engineering 4, 1208–1220",
    url: "https://doi.org/10.1038/s41551-020-00640-6",
  },
  miller: {
    short: "Miller et al. 2020",
    title: "Analyzing changes in respiratory rate to predict the risk of COVID-19 infection. PLOS ONE 15(12), e0243693",
    url: "https://doi.org/10.1371/journal.pone.0243693",
  },
  fullagar: {
    short: "Fullagar et al. 2015",
    title: "Sleep and athletic performance: the effects of sleep loss on exercise performance, and physiological and cognitive responses to exercise. Sports Medicine 45(2), 161–186",
    url: "https://doi.org/10.1007/s40279-014-0260-0",
  },
  fitWorkout: {
    short: "Garmin FIT SDK",
    title: "FIT Cookbook: Encoding Workout Files – offizielle Dokumentation von Garmin",
    url: "https://developer.garmin.com/fit/cookbook/encoding-workout-files/",
  },
  bleHr: {
    short: "Bluetooth SIG",
    title: "Heart Rate Service 1.0 – Spezifikation der Bluetooth Special Interest Group",
    url: "https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/",
  },
  fit: {
    short: "Garmin FIT SDK",
    title: "Flexible and Interoperable Data Transfer (FIT) Protocol – offizielles SDK von Garmin",
    url: "https://developer.garmin.com/fit/overview/",
  },
};

export function cite(id) {
  const s = SOURCES[id];
  return s ? `<a class="cite" href="${s.url}" target="_blank" rel="noopener" title="${s.title}">${s.short}</a>` : "";
}
