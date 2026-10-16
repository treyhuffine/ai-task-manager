/**
 * Reference places for deterministic time-zone resolution: common IATA
 * airports and cities with their IANA zones. Public reference data, not
 * personal data. A place that is not listed resolves to no zone, and the
 * itinerary says so instead of guessing.
 */

// CODE|City|Country|Zone. Keep entries sorted by region for review.
const AIRPORTS_SOURCE = `
ATL|Atlanta|United States|America/New_York
LAX|Los Angeles|United States|America/Los_Angeles
ORD|Chicago|United States|America/Chicago
MDW|Chicago|United States|America/Chicago
DFW|Dallas|United States|America/Chicago
DAL|Dallas|United States|America/Chicago
DEN|Denver|United States|America/Denver
JFK|New York|United States|America/New_York
LGA|New York|United States|America/New_York
EWR|Newark|United States|America/New_York
SFO|San Francisco|United States|America/Los_Angeles
OAK|Oakland|United States|America/Los_Angeles
SJC|San Jose|United States|America/Los_Angeles
SEA|Seattle|United States|America/Los_Angeles
LAS|Las Vegas|United States|America/Los_Angeles
MCO|Orlando|United States|America/New_York
MIA|Miami|United States|America/New_York
FLL|Fort Lauderdale|United States|America/New_York
CLT|Charlotte|United States|America/New_York
PHX|Phoenix|United States|America/Phoenix
IAH|Houston|United States|America/Chicago
HOU|Houston|United States|America/Chicago
BOS|Boston|United States|America/New_York
MSP|Minneapolis|United States|America/Chicago
DTW|Detroit|United States|America/Detroit
PHL|Philadelphia|United States|America/New_York
BWI|Baltimore|United States|America/New_York
DCA|Washington|United States|America/New_York
IAD|Washington|United States|America/New_York
SLC|Salt Lake City|United States|America/Denver
SAN|San Diego|United States|America/Los_Angeles
TPA|Tampa|United States|America/New_York
PDX|Portland|United States|America/Los_Angeles
HNL|Honolulu|United States|Pacific/Honolulu
OGG|Kahului|United States|Pacific/Honolulu
KOA|Kona|United States|Pacific/Honolulu
LIH|Lihue|United States|Pacific/Honolulu
ANC|Anchorage|United States|America/Anchorage
FAI|Fairbanks|United States|America/Anchorage
JNU|Juneau|United States|America/Juneau
AUS|Austin|United States|America/Chicago
BNA|Nashville|United States|America/Chicago
MSY|New Orleans|United States|America/Chicago
STL|St. Louis|United States|America/Chicago
MCI|Kansas City|United States|America/Chicago
RDU|Raleigh|United States|America/New_York
SMF|Sacramento|United States|America/Los_Angeles
SNA|Santa Ana|United States|America/Los_Angeles
BUR|Burbank|United States|America/Los_Angeles
LGB|Long Beach|United States|America/Los_Angeles
ONT|Ontario|United States|America/Los_Angeles
PIT|Pittsburgh|United States|America/New_York
CLE|Cleveland|United States|America/New_York
CMH|Columbus|United States|America/New_York
IND|Indianapolis|United States|America/Indiana/Indianapolis
CVG|Cincinnati|United States|America/New_York
MKE|Milwaukee|United States|America/Chicago
SAT|San Antonio|United States|America/Chicago
ABQ|Albuquerque|United States|America/Denver
BOI|Boise|United States|America/Boise
JAC|Jackson Hole|United States|America/Denver
ASE|Aspen|United States|America/Denver
EGE|Vail|United States|America/Denver
COS|Colorado Springs|United States|America/Denver
BZN|Bozeman|United States|America/Denver
TUS|Tucson|United States|America/Phoenix
RNO|Reno|United States|America/Los_Angeles
PSP|Palm Springs|United States|America/Los_Angeles
SJU|San Juan|Puerto Rico|America/Puerto_Rico
JAX|Jacksonville|United States|America/New_York
RSW|Fort Myers|United States|America/New_York
PBI|West Palm Beach|United States|America/New_York
SAV|Savannah|United States|America/New_York
CHS|Charleston|United States|America/New_York
BDL|Hartford|United States|America/New_York
PVD|Providence|United States|America/New_York
BUF|Buffalo|United States|America/New_York
ALB|Albany|United States|America/New_York
OMA|Omaha|United States|America/Chicago
OKC|Oklahoma City|United States|America/Chicago
TUL|Tulsa|United States|America/Chicago
MEM|Memphis|United States|America/Chicago
SDF|Louisville|United States|America/Kentucky/Louisville
RIC|Richmond|United States|America/New_York
ORF|Norfolk|United States|America/New_York
GEG|Spokane|United States|America/Los_Angeles
ELP|El Paso|United States|America/Denver
MSN|Madison|United States|America/Chicago
DSM|Des Moines|United States|America/Chicago
BTV|Burlington|United States|America/New_York
PWM|Portland, Maine|United States|America/New_York
YYZ|Toronto|Canada|America/Toronto
YTZ|Toronto|Canada|America/Toronto
YVR|Vancouver|Canada|America/Vancouver
YUL|Montreal|Canada|America/Toronto
YYC|Calgary|Canada|America/Edmonton
YEG|Edmonton|Canada|America/Edmonton
YOW|Ottawa|Canada|America/Toronto
YHZ|Halifax|Canada|America/Halifax
YWG|Winnipeg|Canada|America/Winnipeg
YQB|Quebec City|Canada|America/Toronto
YYJ|Victoria|Canada|America/Vancouver
YXE|Saskatoon|Canada|America/Regina
YYT|St. John's|Canada|America/St_Johns
MEX|Mexico City|Mexico|America/Mexico_City
CUN|Cancun|Mexico|America/Cancun
GDL|Guadalajara|Mexico|America/Mexico_City
MTY|Monterrey|Mexico|America/Monterrey
SJD|Los Cabos|Mexico|America/Mazatlan
PVR|Puerto Vallarta|Mexico|America/Mexico_City
OAX|Oaxaca|Mexico|America/Mexico_City
TIJ|Tijuana|Mexico|America/Tijuana
MID|Merida|Mexico|America/Merida
SJO|San Jose, Costa Rica|Costa Rica|America/Costa_Rica
LIR|Liberia|Costa Rica|America/Costa_Rica
PTY|Panama City|Panama|America/Panama
GUA|Guatemala City|Guatemala|America/Guatemala
SAL|San Salvador|El Salvador|America/El_Salvador
BZE|Belize City|Belize|America/Belize
NAS|Nassau|Bahamas|America/Nassau
MBJ|Montego Bay|Jamaica|America/Jamaica
KIN|Kingston|Jamaica|America/Jamaica
PUJ|Punta Cana|Dominican Republic|America/Santo_Domingo
SDQ|Santo Domingo|Dominican Republic|America/Santo_Domingo
HAV|Havana|Cuba|America/Havana
AUA|Aruba|Aruba|America/Aruba
CUR|Curacao|Curacao|America/Curacao
BGI|Bridgetown|Barbados|America/Barbados
SXM|Sint Maarten|Sint Maarten|America/Lower_Princes
STT|St. Thomas|US Virgin Islands|America/St_Thomas
POS|Port of Spain|Trinidad and Tobago|America/Port_of_Spain
GRU|Sao Paulo|Brazil|America/Sao_Paulo
CGH|Sao Paulo|Brazil|America/Sao_Paulo
GIG|Rio de Janeiro|Brazil|America/Sao_Paulo
SDU|Rio de Janeiro|Brazil|America/Sao_Paulo
BSB|Brasilia|Brazil|America/Sao_Paulo
FLN|Florianopolis|Brazil|America/Sao_Paulo
SSA|Salvador|Brazil|America/Bahia
REC|Recife|Brazil|America/Recife
FOR|Fortaleza|Brazil|America/Fortaleza
POA|Porto Alegre|Brazil|America/Sao_Paulo
MAO|Manaus|Brazil|America/Manaus
EZE|Buenos Aires|Argentina|America/Argentina/Buenos_Aires
AEP|Buenos Aires|Argentina|America/Argentina/Buenos_Aires
SCL|Santiago|Chile|America/Santiago
LIM|Lima|Peru|America/Lima
CUZ|Cusco|Peru|America/Lima
BOG|Bogota|Colombia|America/Bogota
MDE|Medellin|Colombia|America/Bogota
CTG|Cartagena|Colombia|America/Bogota
UIO|Quito|Ecuador|America/Guayaquil
GYE|Guayaquil|Ecuador|America/Guayaquil
CCS|Caracas|Venezuela|America/Caracas
MVD|Montevideo|Uruguay|America/Montevideo
ASU|Asuncion|Paraguay|America/Asuncion
LPB|La Paz|Bolivia|America/La_Paz
LHR|London|United Kingdom|Europe/London
LGW|London|United Kingdom|Europe/London
STN|London|United Kingdom|Europe/London
LTN|London|United Kingdom|Europe/London
LCY|London|United Kingdom|Europe/London
MAN|Manchester|United Kingdom|Europe/London
BHX|Birmingham|United Kingdom|Europe/London
EDI|Edinburgh|United Kingdom|Europe/London
GLA|Glasgow|United Kingdom|Europe/London
BRS|Bristol|United Kingdom|Europe/London
LPL|Liverpool|United Kingdom|Europe/London
NCL|Newcastle|United Kingdom|Europe/London
BFS|Belfast|United Kingdom|Europe/London
DUB|Dublin|Ireland|Europe/Dublin
SNN|Shannon|Ireland|Europe/Dublin
ORK|Cork|Ireland|Europe/Dublin
CDG|Paris|France|Europe/Paris
ORY|Paris|France|Europe/Paris
BVA|Beauvais|France|Europe/Paris
NCE|Nice|France|Europe/Paris
LYS|Lyon|France|Europe/Paris
MRS|Marseille|France|Europe/Paris
TLS|Toulouse|France|Europe/Paris
BOD|Bordeaux|France|Europe/Paris
NTE|Nantes|France|Europe/Paris
BSL|Basel|Switzerland|Europe/Zurich
GVA|Geneva|Switzerland|Europe/Zurich
ZRH|Zurich|Switzerland|Europe/Zurich
AMS|Amsterdam|Netherlands|Europe/Amsterdam
EIN|Eindhoven|Netherlands|Europe/Amsterdam
RTM|Rotterdam|Netherlands|Europe/Amsterdam
BRU|Brussels|Belgium|Europe/Brussels
CRL|Charleroi|Belgium|Europe/Brussels
LUX|Luxembourg|Luxembourg|Europe/Luxembourg
FRA|Frankfurt|Germany|Europe/Berlin
MUC|Munich|Germany|Europe/Berlin
BER|Berlin|Germany|Europe/Berlin
HAM|Hamburg|Germany|Europe/Berlin
DUS|Dusseldorf|Germany|Europe/Berlin
CGN|Cologne|Germany|Europe/Berlin
STR|Stuttgart|Germany|Europe/Berlin
HAJ|Hanover|Germany|Europe/Berlin
NUE|Nuremberg|Germany|Europe/Berlin
LEJ|Leipzig|Germany|Europe/Berlin
DRS|Dresden|Germany|Europe/Berlin
VIE|Vienna|Austria|Europe/Vienna
SZG|Salzburg|Austria|Europe/Vienna
INN|Innsbruck|Austria|Europe/Vienna
PRG|Prague|Czechia|Europe/Prague
BUD|Budapest|Hungary|Europe/Budapest
BTS|Bratislava|Slovakia|Europe/Bratislava
WAW|Warsaw|Poland|Europe/Warsaw
KRK|Krakow|Poland|Europe/Warsaw
GDN|Gdansk|Poland|Europe/Warsaw
WRO|Wroclaw|Poland|Europe/Warsaw
CPH|Copenhagen|Denmark|Europe/Copenhagen
ARN|Stockholm|Sweden|Europe/Stockholm
GOT|Gothenburg|Sweden|Europe/Stockholm
OSL|Oslo|Norway|Europe/Oslo
BGO|Bergen|Norway|Europe/Oslo
TRD|Trondheim|Norway|Europe/Oslo
TOS|Tromso|Norway|Europe/Oslo
HEL|Helsinki|Finland|Europe/Helsinki
RVN|Rovaniemi|Finland|Europe/Helsinki
KEF|Reykjavik|Iceland|Atlantic/Reykjavik
TLL|Tallinn|Estonia|Europe/Tallinn
RIX|Riga|Latvia|Europe/Riga
VNO|Vilnius|Lithuania|Europe/Vilnius
MAD|Madrid|Spain|Europe/Madrid
BCN|Barcelona|Spain|Europe/Madrid
AGP|Malaga|Spain|Europe/Madrid
PMI|Palma|Spain|Europe/Madrid
ALC|Alicante|Spain|Europe/Madrid
VLC|Valencia|Spain|Europe/Madrid
SVQ|Seville|Spain|Europe/Madrid
BIO|Bilbao|Spain|Europe/Madrid
IBZ|Ibiza|Spain|Europe/Madrid
LPA|Las Palmas|Spain|Atlantic/Canary
TFS|Tenerife|Spain|Atlantic/Canary
TFN|Tenerife|Spain|Atlantic/Canary
ACE|Lanzarote|Spain|Atlantic/Canary
LIS|Lisbon|Portugal|Europe/Lisbon
OPO|Porto|Portugal|Europe/Lisbon
FAO|Faro|Portugal|Europe/Lisbon
FNC|Funchal|Portugal|Atlantic/Madeira
PDL|Ponta Delgada|Portugal|Atlantic/Azores
FCO|Rome|Italy|Europe/Rome
CIA|Rome|Italy|Europe/Rome
MXP|Milan|Italy|Europe/Rome
LIN|Milan|Italy|Europe/Rome
BGY|Bergamo|Italy|Europe/Rome
VCE|Venice|Italy|Europe/Rome
TSF|Treviso|Italy|Europe/Rome
FLR|Florence|Italy|Europe/Rome
PSA|Pisa|Italy|Europe/Rome
NAP|Naples|Italy|Europe/Rome
BLQ|Bologna|Italy|Europe/Rome
TRN|Turin|Italy|Europe/Rome
CTA|Catania|Italy|Europe/Rome
PMO|Palermo|Italy|Europe/Rome
BRI|Bari|Italy|Europe/Rome
CAG|Cagliari|Italy|Europe/Rome
OLB|Olbia|Italy|Europe/Rome
VRN|Verona|Italy|Europe/Rome
GOA|Genoa|Italy|Europe/Rome
ATH|Athens|Greece|Europe/Athens
SKG|Thessaloniki|Greece|Europe/Athens
HER|Heraklion|Greece|Europe/Athens
JTR|Santorini|Greece|Europe/Athens
JMK|Mykonos|Greece|Europe/Athens
CFU|Corfu|Greece|Europe/Athens
RHO|Rhodes|Greece|Europe/Athens
CHQ|Chania|Greece|Europe/Athens
IST|Istanbul|Turkey|Europe/Istanbul
SAW|Istanbul|Turkey|Europe/Istanbul
AYT|Antalya|Turkey|Europe/Istanbul
ESB|Ankara|Turkey|Europe/Istanbul
ADB|Izmir|Turkey|Europe/Istanbul
OTP|Bucharest|Romania|Europe/Bucharest
SOF|Sofia|Bulgaria|Europe/Sofia
BEG|Belgrade|Serbia|Europe/Belgrade
ZAG|Zagreb|Croatia|Europe/Zagreb
SPU|Split|Croatia|Europe/Zagreb
DBV|Dubrovnik|Croatia|Europe/Zagreb
LJU|Ljubljana|Slovenia|Europe/Ljubljana
SJJ|Sarajevo|Bosnia and Herzegovina|Europe/Sarajevo
TIA|Tirana|Albania|Europe/Tirane
SKP|Skopje|North Macedonia|Europe/Skopje
TGD|Podgorica|Montenegro|Europe/Podgorica
TIV|Tivat|Montenegro|Europe/Podgorica
MLA|Valletta|Malta|Europe/Malta
LCA|Larnaca|Cyprus|Asia/Nicosia
PFO|Paphos|Cyprus|Asia/Nicosia
KBP|Kyiv|Ukraine|Europe/Kyiv
KIV|Chisinau|Moldova|Europe/Chisinau
TBS|Tbilisi|Georgia|Asia/Tbilisi
EVN|Yerevan|Armenia|Asia/Yerevan
GYD|Baku|Azerbaijan|Asia/Baku
SVO|Moscow|Russia|Europe/Moscow
DME|Moscow|Russia|Europe/Moscow
LED|St. Petersburg|Russia|Europe/Moscow
DXB|Dubai|United Arab Emirates|Asia/Dubai
DWC|Dubai|United Arab Emirates|Asia/Dubai
AUH|Abu Dhabi|United Arab Emirates|Asia/Dubai
DOH|Doha|Qatar|Asia/Qatar
BAH|Manama|Bahrain|Asia/Bahrain
KWI|Kuwait City|Kuwait|Asia/Kuwait
MCT|Muscat|Oman|Asia/Muscat
RUH|Riyadh|Saudi Arabia|Asia/Riyadh
JED|Jeddah|Saudi Arabia|Asia/Riyadh
AMM|Amman|Jordan|Asia/Amman
TLV|Tel Aviv|Israel|Asia/Jerusalem
BEY|Beirut|Lebanon|Asia/Beirut
CAI|Cairo|Egypt|Africa/Cairo
HRG|Hurghada|Egypt|Africa/Cairo
SSH|Sharm el Sheikh|Egypt|Africa/Cairo
CMN|Casablanca|Morocco|Africa/Casablanca
RAK|Marrakech|Morocco|Africa/Casablanca
TUN|Tunis|Tunisia|Africa/Tunis
ALG|Algiers|Algeria|Africa/Algiers
ADD|Addis Ababa|Ethiopia|Africa/Addis_Ababa
NBO|Nairobi|Kenya|Africa/Nairobi
MBA|Mombasa|Kenya|Africa/Nairobi
DAR|Dar es Salaam|Tanzania|Africa/Dar_es_Salaam
ZNZ|Zanzibar|Tanzania|Africa/Dar_es_Salaam
JRO|Kilimanjaro|Tanzania|Africa/Dar_es_Salaam
EBB|Entebbe|Uganda|Africa/Kampala
KGL|Kigali|Rwanda|Africa/Kigali
LOS|Lagos|Nigeria|Africa/Lagos
ABV|Abuja|Nigeria|Africa/Lagos
ACC|Accra|Ghana|Africa/Accra
DSS|Dakar|Senegal|Africa/Dakar
JNB|Johannesburg|South Africa|Africa/Johannesburg
CPT|Cape Town|South Africa|Africa/Johannesburg
DUR|Durban|South Africa|Africa/Johannesburg
WDH|Windhoek|Namibia|Africa/Windhoek
VFA|Victoria Falls|Zimbabwe|Africa/Harare
LUN|Lusaka|Zambia|Africa/Lusaka
MRU|Mauritius|Mauritius|Indian/Mauritius
SEZ|Mahe|Seychelles|Indian/Mahe
TNR|Antananarivo|Madagascar|Indian/Antananarivo
RUN|Saint-Denis|Reunion|Indian/Reunion
HND|Tokyo|Japan|Asia/Tokyo
NRT|Tokyo|Japan|Asia/Tokyo
KIX|Osaka|Japan|Asia/Tokyo
ITM|Osaka|Japan|Asia/Tokyo
NGO|Nagoya|Japan|Asia/Tokyo
CTS|Sapporo|Japan|Asia/Tokyo
FUK|Fukuoka|Japan|Asia/Tokyo
OKA|Okinawa|Japan|Asia/Tokyo
ICN|Seoul|South Korea|Asia/Seoul
GMP|Seoul|South Korea|Asia/Seoul
PUS|Busan|South Korea|Asia/Seoul
CJU|Jeju|South Korea|Asia/Seoul
PEK|Beijing|China|Asia/Shanghai
PKX|Beijing|China|Asia/Shanghai
PVG|Shanghai|China|Asia/Shanghai
SHA|Shanghai|China|Asia/Shanghai
CAN|Guangzhou|China|Asia/Shanghai
SZX|Shenzhen|China|Asia/Shanghai
CTU|Chengdu|China|Asia/Shanghai
TFU|Chengdu|China|Asia/Shanghai
XIY|Xi'an|China|Asia/Shanghai
KMG|Kunming|China|Asia/Shanghai
HGH|Hangzhou|China|Asia/Shanghai
CKG|Chongqing|China|Asia/Shanghai
HKG|Hong Kong|Hong Kong|Asia/Hong_Kong
MFM|Macau|Macau|Asia/Macau
TPE|Taipei|Taiwan|Asia/Taipei
TSA|Taipei|Taiwan|Asia/Taipei
KHH|Kaohsiung|Taiwan|Asia/Taipei
MNL|Manila|Philippines|Asia/Manila
CEB|Cebu|Philippines|Asia/Manila
BKK|Bangkok|Thailand|Asia/Bangkok
DMK|Bangkok|Thailand|Asia/Bangkok
HKT|Phuket|Thailand|Asia/Bangkok
CNX|Chiang Mai|Thailand|Asia/Bangkok
USM|Koh Samui|Thailand|Asia/Bangkok
SIN|Singapore|Singapore|Asia/Singapore
KUL|Kuala Lumpur|Malaysia|Asia/Kuala_Lumpur
PEN|Penang|Malaysia|Asia/Kuala_Lumpur
BKI|Kota Kinabalu|Malaysia|Asia/Kuching
CGK|Jakarta|Indonesia|Asia/Jakarta
DPS|Bali|Indonesia|Asia/Makassar
SUB|Surabaya|Indonesia|Asia/Jakarta
SGN|Ho Chi Minh City|Vietnam|Asia/Ho_Chi_Minh
HAN|Hanoi|Vietnam|Asia/Ho_Chi_Minh
DAD|Da Nang|Vietnam|Asia/Ho_Chi_Minh
PNH|Phnom Penh|Cambodia|Asia/Phnom_Penh
REP|Siem Reap|Cambodia|Asia/Phnom_Penh
VTE|Vientiane|Laos|Asia/Vientiane
RGN|Yangon|Myanmar|Asia/Yangon
DEL|Delhi|India|Asia/Kolkata
BOM|Mumbai|India|Asia/Kolkata
BLR|Bengaluru|India|Asia/Kolkata
MAA|Chennai|India|Asia/Kolkata
HYD|Hyderabad|India|Asia/Kolkata
CCU|Kolkata|India|Asia/Kolkata
GOI|Goa|India|Asia/Kolkata
COK|Kochi|India|Asia/Kolkata
AMD|Ahmedabad|India|Asia/Kolkata
JAI|Jaipur|India|Asia/Kolkata
KTM|Kathmandu|Nepal|Asia/Kathmandu
CMB|Colombo|Sri Lanka|Asia/Colombo
MLE|Male|Maldives|Indian/Maldives
DAC|Dhaka|Bangladesh|Asia/Dhaka
ISB|Islamabad|Pakistan|Asia/Karachi
KHI|Karachi|Pakistan|Asia/Karachi
LHE|Lahore|Pakistan|Asia/Karachi
TAS|Tashkent|Uzbekistan|Asia/Tashkent
ALA|Almaty|Kazakhstan|Asia/Almaty
UBN|Ulaanbaatar|Mongolia|Asia/Ulaanbaatar
SYD|Sydney|Australia|Australia/Sydney
MEL|Melbourne|Australia|Australia/Melbourne
BNE|Brisbane|Australia|Australia/Brisbane
PER|Perth|Australia|Australia/Perth
ADL|Adelaide|Australia|Australia/Adelaide
CBR|Canberra|Australia|Australia/Sydney
OOL|Gold Coast|Australia|Australia/Brisbane
CNS|Cairns|Australia|Australia/Brisbane
HBA|Hobart|Australia|Australia/Hobart
DRW|Darwin|Australia|Australia/Darwin
AKL|Auckland|New Zealand|Pacific/Auckland
WLG|Wellington|New Zealand|Pacific/Auckland
CHC|Christchurch|New Zealand|Pacific/Auckland
ZQN|Queenstown|New Zealand|Pacific/Auckland
NAN|Nadi|Fiji|Pacific/Fiji
PPT|Papeete|French Polynesia|Pacific/Tahiti
NOU|Noumea|New Caledonia|Pacific/Noumea
GUM|Guam|Guam|Pacific/Guam
RAR|Rarotonga|Cook Islands|Pacific/Rarotonga
APW|Apia|Samoa|Pacific/Apia
`;

// City|Zone for places without an airport above, alternate spellings and station names.
const CITIES_SOURCE = `
Sintra|Europe/Lisbon
Cascais|Europe/Lisbon
Lisboa|Europe/Lisbon
Belem|Europe/Lisbon
Coimbra|Europe/Lisbon
Evora|Europe/Lisbon
Braga|Europe/Lisbon
Madeira|Atlantic/Madeira
Azores|Atlantic/Azores
Sevilla|Europe/Madrid
Granada|Europe/Madrid
Cordoba, Spain|Europe/Madrid
San Sebastian|Europe/Madrid
Toledo|Europe/Madrid
Salamanca|Europe/Madrid
Santiago de Compostela|Europe/Madrid
Roma|Europe/Rome
Milano|Europe/Rome
Firenze|Europe/Rome
Venezia|Europe/Rome
Napoli|Europe/Rome
Torino|Europe/Rome
Siena|Europe/Rome
Amalfi|Europe/Rome
Positano|Europe/Rome
Sorrento|Europe/Rome
Como|Europe/Rome
Munchen|Europe/Berlin
Koln|Europe/Berlin
Heidelberg|Europe/Berlin
Wien|Europe/Vienna
Praha|Europe/Prague
Bruxelles|Europe/Brussels
Brugge|Europe/Brussels
Bruges|Europe/Brussels
Antwerp|Europe/Brussels
Ghent|Europe/Brussels
Geneve|Europe/Zurich
Lausanne|Europe/Zurich
Lucerne|Europe/Zurich
Interlaken|Europe/Zurich
Zermatt|Europe/Zurich
Bern|Europe/Zurich
The Hague|Europe/Amsterdam
Utrecht|Europe/Amsterdam
Oxford|Europe/London
Cambridge, United Kingdom|Europe/London
Bath|Europe/London
York|Europe/London
Brighton|Europe/London
Galway|Europe/Dublin
Kyoto|Asia/Tokyo
Nara|Asia/Tokyo
Hiroshima|Asia/Tokyo
Yokohama|Asia/Tokyo
Hakone|Asia/Tokyo
Nikko|Asia/Tokyo
Kanazawa|Asia/Tokyo
Edinburgh Waverley|Europe/London
Brooklyn|America/New_York
Manhattan|America/New_York
Santa Monica|America/Los_Angeles
Hollywood|America/Los_Angeles
Napa|America/Los_Angeles
Sonoma|America/Los_Angeles
Palo Alto|America/Los_Angeles
Berkeley|America/Los_Angeles
Tacoma|America/Los_Angeles
Eugene|America/Los_Angeles
Boulder|America/Denver
Fort Collins|America/Denver
Breckenridge|America/Denver
Moab|America/Denver
Santa Fe|America/Denver
Sedona|America/Phoenix
Scottsdale|America/Phoenix
Flagstaff|America/Phoenix
Miami Beach|America/New_York
Key West|America/New_York
Cambridge, Massachusetts|America/New_York
Quebec|America/Toronto
Banff|America/Edmonton
Whistler|America/Vancouver
Tulum|America/Cancun
Playa del Carmen|America/Cancun
Marrakesh|Africa/Casablanca
Fes|Africa/Casablanca
`;

export interface Airport { code: string; city: string; country: string; zone: string }

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const AIRPORTS = new Map<string, Airport>();
for (const line of AIRPORTS_SOURCE.trim().split("\n")) {
  const [code, city, country, zone] = line.split("|");
  AIRPORTS.set(code, { code, city, country, zone });
}

/** Folded city name to zone. A name that maps to several zones is ambiguous and resolves to null. */
const CITY_ZONES = new Map<string, string | null>();
function addCity(name: string, zone: string) {
  const key = fold(name);
  if (!key) return;
  const existing = CITY_ZONES.get(key);
  if (existing === undefined) CITY_ZONES.set(key, zone);
  else if (existing !== zone) CITY_ZONES.set(key, null);
}
for (const airport of AIRPORTS.values()) addCity(airport.city, airport.zone);
for (const line of CITIES_SOURCE.trim().split("\n")) {
  const [name, zone] = line.split("|");
  addCity(name, zone);
}
// Names shared by unrelated places in different zones resolve to nothing
// unless written with a qualifier such as "Cambridge, Massachusetts".
for (const name of ["Victoria", "Kingston", "Santiago", "Cordoba", "Cambridge", "Birmingham", "Richmond", "Ontario", "Liberia"])
  CITY_ZONES.set(fold(name), null);
// Portland and San Jose mean the larger city unless a qualifier says otherwise.
CITY_ZONES.set(fold("Portland"), "America/Los_Angeles");
CITY_ZONES.set(fold("San Jose"), "America/Los_Angeles");

export function airport(code: string | null | undefined): Airport | null {
  if (!code) return null;
  return AIRPORTS.get(code.trim().toUpperCase()) ?? null;
}
export function isKnownAirport(code: string): boolean {
  return AIRPORTS.has(code);
}
/** The zone for a city name, or null when unknown or ambiguous. */
export function cityZone(name: string | null | undefined): string | null {
  if (!name) return null;
  return CITY_ZONES.get(fold(name)) ?? null;
}
const SORTED_CITY_KEYS = [...CITY_ZONES.keys()].sort((a, b) => b.length - a.length);
/**
 * Find a known city inside free text such as an address or station name.
 * Longer names win ("Palo Alto" before "Alto"). Returns the zone and the
 * matched name, or null when nothing unambiguous is found.
 */
export function findCityZone(text: string | null | undefined): { city: string; zone: string } | null {
  if (!text) return null;
  const folded = ` ${fold(text)} `;
  for (const key of SORTED_CITY_KEYS) {
    if (key.length < 3) continue;
    if (folded.includes(` ${key} `)) {
      const zone = CITY_ZONES.get(key);
      if (!zone) return null;
      return { city: key.replace(/\b\w/g, (c) => c.toUpperCase()), zone };
    }
  }
  return null;
}
/** A display city for an airport code, such as "Lisbon". */
export function airportCity(code: string | null | undefined): string | null {
  return airport(code)?.city.replace(/,.*$/, "") ?? null;
}
