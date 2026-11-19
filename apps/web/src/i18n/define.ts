/** A message is a string, or the forms of a plural: `{ one, other }`, picked by the `count` parameter. */
export type Message = string | { one: string; other: string };

/**
 * One area's messages in every language. `en` is the source: its keys are the keys of the area, and `es` must have
 * exactly the same ones, so a missing translation is a type error and not a hole in the screen.
 */
export function defineMessages<const E extends Record<string, Message>>(messages: {
  en: E;
  es: { [K in keyof E]: Message };
}) {
  return messages;
}
