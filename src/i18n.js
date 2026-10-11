// -----------------------------------------------------------------------------
// Languages of the texts the integration produces.
//
// Gladys exists in English, French, German and Spanish, and shows the text of
// the user's language, English otherwise. A widget content or an action
// result is resolved by the front in the user's language; an error thrown to
// a device command or a scene action is a plain string, picked here from the
// `language` of the configuration (the core does not tell the user's).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The text of `language` in a `{ en, fr, de, es }` object, English otherwise. */
export function localize(text, language) {
  return text[language] ?? text.en;
}

/** An error whose message is meant for the user, in `{ en, fr, de, es }`. */
export class UserError extends Error {
  constructor(text, language = 'en', cause) {
    super(localize(text, language), { cause });
    this.name = 'UserError';
    this.text = text;
  }
}
