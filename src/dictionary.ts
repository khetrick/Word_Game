import englishWordsUrl from 'an-array-of-english-words/index.json?url';

const PLAYABLE_WORD = /^[a-z]{3,}$/;

export const loadDictionary = async () => {
  const response = await fetch(englishWordsUrl);
  const words = (await response.json()) as string[];
  return new Set<string>(words.filter((word) => PLAYABLE_WORD.test(word)));
};
