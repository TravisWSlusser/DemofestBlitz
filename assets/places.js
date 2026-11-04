/* places.js — where a player says they are from, resolved to a map point.
   [label, lat, lon]. Approximate centroids are all a burst needs.
   US states first (the DevLearn crowd), then Canadian provinces, then
   countries. Add a line to add a place; the sign-in datalist reads this. */
window.PLACES = [
  // ── United States ──
  ['Alabama, USA',32.8,-86.8],['Alaska, USA',64.2,-152.5],['Arizona, USA',34.3,-111.7],['Arkansas, USA',34.9,-92.4],
  ['California, USA',37.2,-119.5],['Colorado, USA',39.0,-105.5],['Connecticut, USA',41.6,-72.7],['Delaware, USA',39.0,-75.5],
  ['Florida, USA',28.6,-82.4],['Georgia, USA',32.7,-83.4],['Hawaii, USA',20.8,-156.3],['Idaho, USA',44.4,-114.6],
  ['Illinois, USA',40.0,-89.2],['Indiana, USA',39.9,-86.3],['Iowa, USA',42.1,-93.5],['Kansas, USA',38.5,-98.4],
  ['Kentucky, USA',37.5,-85.3],['Louisiana, USA',31.1,-92.0],['Maine, USA',45.4,-69.2],['Maryland, USA',39.1,-76.8],
  ['Massachusetts, USA',42.3,-71.8],['Michigan, USA',44.3,-85.4],['Minnesota, USA',46.3,-94.3],['Mississippi, USA',32.7,-89.7],
  ['Missouri, USA',38.4,-92.5],['Montana, USA',47.0,-109.6],['Nebraska, USA',41.5,-99.8],['Nevada, USA',39.3,-116.6],
  ['New Hampshire, USA',43.7,-71.6],['New Jersey, USA',40.2,-74.7],['New Mexico, USA',34.4,-106.1],['New York, USA',42.9,-75.5],
  ['North Carolina, USA',35.6,-79.4],['North Dakota, USA',47.4,-100.5],['Ohio, USA',40.3,-82.8],['Oklahoma, USA',35.6,-97.5],
  ['Oregon, USA',43.9,-120.6],['Pennsylvania, USA',40.9,-77.8],['Rhode Island, USA',41.7,-71.5],['South Carolina, USA',33.9,-80.9],
  ['South Dakota, USA',44.4,-100.2],['Tennessee, USA',35.9,-86.4],['Texas, USA',31.5,-99.3],['Utah, USA',39.3,-111.7],
  ['Vermont, USA',44.1,-72.7],['Virginia, USA',37.5,-78.8],['Washington, USA',47.4,-120.5],['Washington, DC, USA',38.9,-77.0],
  ['West Virginia, USA',38.6,-80.6],['Wisconsin, USA',44.6,-89.9],['Wyoming, USA',43.0,-107.5],['Puerto Rico, USA',18.2,-66.5],
  ['United States',39.8,-98.6],
  // ── Canada ──
  ['Alberta, Canada',55.0,-115.0],['British Columbia, Canada',54.0,-125.0],['Manitoba, Canada',55.0,-97.0],['New Brunswick, Canada',46.5,-66.2],
  ['Newfoundland and Labrador, Canada',53.5,-60.0],['Nova Scotia, Canada',45.0,-63.0],['Ontario, Canada',50.0,-85.0],['Prince Edward Island, Canada',46.3,-63.2],
  ['Quebec, Canada',52.0,-72.0],['Saskatchewan, Canada',54.0,-106.0],['Yukon, Canada',64.0,-135.0],['Northwest Territories, Canada',64.5,-119.0],['Nunavut, Canada',66.0,-90.0],
  ['Canada',56.1,-106.3],
  // ── Americas ──
  ['Mexico',23.6,-102.6],['Guatemala',15.8,-90.2],['Belize',17.2,-88.5],['Honduras',15.2,-86.2],['El Salvador',13.8,-88.9],['Nicaragua',12.9,-85.2],
  ['Costa Rica',9.7,-83.8],['Panama',8.5,-80.8],['Cuba',21.5,-79.5],['Jamaica',18.1,-77.3],['Haiti',19.0,-72.3],['Dominican Republic',18.7,-70.2],
  ['Bahamas',24.3,-76.0],['Trinidad and Tobago',10.7,-61.2],['Barbados',13.2,-59.5],['Colombia',4.6,-74.3],['Venezuela',6.4,-66.6],['Ecuador',-1.8,-78.2],
  ['Peru',-9.2,-75.0],['Bolivia',-16.3,-63.6],['Brazil',-10.3,-53.2],['Paraguay',-23.4,-58.4],['Uruguay',-32.5,-55.8],['Argentina',-34.0,-64.0],['Chile',-35.7,-71.5],
  // ── Europe ──
  ['United Kingdom',54.0,-2.5],['England, UK',52.6,-1.5],['Scotland, UK',56.5,-4.2],['Wales, UK',52.3,-3.6],['Northern Ireland, UK',54.6,-6.5],
  ['Ireland',53.3,-8.0],['Iceland',64.9,-18.6],['Norway',62.0,10.0],['Sweden',62.0,15.0],['Finland',64.0,26.0],['Denmark',56.0,10.0],
  ['Netherlands',52.2,5.3],['Belgium',50.6,4.5],['Luxembourg',49.8,6.1],['France',46.6,2.3],['Spain',40.3,-3.7],['Portugal',39.6,-8.0],
  ['Germany',51.2,10.4],['Switzerland',46.8,8.2],['Austria',47.6,14.1],['Italy',42.5,12.5],['Greece',39.0,22.0],['Poland',52.0,19.4],
  ['Czech Republic',49.8,15.5],['Slovakia',48.7,19.7],['Hungary',47.2,19.5],['Romania',45.9,25.0],['Bulgaria',42.7,25.5],['Croatia',45.1,15.2],
  ['Slovenia',46.1,14.8],['Serbia',44.0,21.0],['Ukraine',48.4,31.2],['Estonia',58.6,25.0],['Latvia',56.9,24.6],['Lithuania',55.2,23.9],['Turkey',39.0,35.0],
  // ── Middle East & Africa ──
  ['Israel',31.5,34.9],['United Arab Emirates',24.0,54.0],['Saudi Arabia',24.0,45.0],['Qatar',25.3,51.2],['Jordan',31.0,36.0],['Egypt',26.8,30.0],
  ['Morocco',32.0,-6.0],['Tunisia',34.0,9.0],['Algeria',28.0,2.0],['Nigeria',9.1,8.7],['Ghana',7.9,-1.0],['Kenya',0.5,37.9],['Ethiopia',9.1,40.5],
  ['Tanzania',-6.4,34.9],['Uganda',1.4,32.3],['Rwanda',-2.0,29.9],['South Africa',-29.0,25.0],['Namibia',-22.0,17.0],['Zimbabwe',-19.0,30.0],['Mozambique',-18.0,35.0],
  // ── Asia Pacific ──
  ['Russia',61.5,99.0],['India',22.0,79.0],['Pakistan',30.4,69.3],['Bangladesh',23.7,90.4],['Sri Lanka',7.9,80.8],['Nepal',28.4,84.1],
  ['China',35.0,105.0],['Hong Kong',22.3,114.2],['Taiwan',23.7,121.0],['Japan',36.2,138.3],['South Korea',36.5,127.9],['Mongolia',46.9,103.8],
  ['Thailand',15.9,100.9],['Vietnam',16.0,107.8],['Malaysia',4.2,102.0],['Singapore',1.35,103.8],['Indonesia',-2.5,118.0],['Philippines',12.9,122.0],
  ['Australia',-25.3,133.8],['New South Wales, Australia',-32.0,147.0],['Victoria, Australia',-37.0,144.0],['Queensland, Australia',-22.5,144.0],
  ['Western Australia, Australia',-26.0,121.0],['South Australia, Australia',-30.0,135.0],['Tasmania, Australia',-42.0,146.5],['New Zealand',-41.5,172.5],['Fiji',-17.8,178.0],
];
