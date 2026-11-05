/* The built-in SAMPLE cards. They play only when a show has no question set of its own: the endless preview, and a
   show started from a plain test link. A real pre-show gets its questions from the launcher on the presenter's
   laptop at launch (see `claim` in preshow.js), so the real questions and answers are never in this public repo.
   Each card: q, a (exactly four answers), ok (index of the right one, 0-3), fact (one line shown with the answer),
   cat / short (category name, and its label on the wheel), d (difficulty 1-3: 100, 200 or 300 points). */
export const SAMPLE_CARDS = [
  { q: 'Which 1927 film is credited as the first feature-length "talkie"?',
    a: ['Metropolis', 'The Jazz Singer', 'Wings', 'Sunrise'], ok: 1, cat: 'Film History', short: 'FILM HISTORY', d: 2,
    fact: 'Audiences heard synchronized dialogue in a feature for the first time.' },
  { q: 'Setup, confrontation, resolution. What is this story shape called?',
    a: ['The three-act structure', 'The montage', 'The cold open', 'The MacGuffin'], ok: 0, cat: 'Storytelling', short: 'STORYTELLING', d: 1,
    fact: 'It is still the backbone of most screenplays, and most good lessons.' },
  { q: 'In film, what is "diegetic" sound?',
    a: ['Sound added only for the audience', 'Sound recorded on location', 'Sound the characters can hear', 'Sound with no dialogue'], ok: 2, cat: 'Film Craft', short: 'FILM CRAFT', d: 3,
    fact: 'A radio playing in the scene is diegetic. The orchestral score is not.' },
  { q: 'Which director made the "dolly zoom" famous in Vertigo (1958)?',
    a: ['Orson Welles', 'Stanley Kubrick', 'Billy Wilder', 'Alfred Hitchcock'], ok: 3, cat: 'Film Craft', short: 'FILM CRAFT', d: 2,
    fact: 'The camera moves one way while the lens zooms the other.' },
  { q: 'Joseph Campbell described a story pattern that shaped Star Wars. What is it called?',
    a: ['The Hero’s Journey', 'The Rashomon effect', 'The Kuleshov effect', 'Chekhov’s gun'], ok: 0, cat: 'Storytelling', short: 'STORYTELLING', d: 2,
    fact: 'A call to adventure, a road of trials, and a return home changed.' },
  { q: 'How many frames per second is the long-standing standard for cinema?',
    a: ['12', '24', '30', '60'], ok: 1, cat: 'Film History', short: 'FILM HISTORY', d: 1,
    fact: 'It became the norm in the late 1920s, when sound needed a steady speed.' }
];
