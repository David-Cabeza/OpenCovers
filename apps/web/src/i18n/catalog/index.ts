import type { Message } from "../define";
import agenda from "./agenda";
import auth from "./auth";
import availability from "./availability";
import common from "./common";
import dates from "./dates";
import elements from "./elements";
import errors from "./errors";
import floor from "./floor";
import layout from "./layout";
import onlinebooking from "./onlinebooking";
import pacing from "./pacing";
import preshift from "./preshift";
import publicprofile from "./publicprofile";
import reservation from "./reservation";
import setup from "./setup";
import team from "./team";
import venue from "./venue";
import waitlist from "./waitlist";

// One file per area keeps the work apart. Every key starts with its area's name (`agenda.title`), so no two files
// collide, which `catalog.test.ts` checks.
export const AREAS = {
  agenda,
  auth,
  availability,
  common,
  dates,
  elements,
  errors,
  floor,
  layout,
  onlinebooking,
  pacing,
  preshift,
  publicprofile,
  reservation,
  setup,
  team,
  venue,
  waitlist,
};

const en = {
  ...agenda.en,
  ...auth.en,
  ...availability.en,
  ...common.en,
  ...dates.en,
  ...elements.en,
  ...errors.en,
  ...floor.en,
  ...layout.en,
  ...onlinebooking.en,
  ...pacing.en,
  ...preshift.en,
  ...publicprofile.en,
  ...reservation.en,
  ...setup.en,
  ...team.en,
  ...venue.en,
  ...waitlist.en,
};

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, Message> = {
  ...agenda.es,
  ...auth.es,
  ...availability.es,
  ...common.es,
  ...dates.es,
  ...elements.es,
  ...errors.es,
  ...floor.es,
  ...layout.es,
  ...onlinebooking.es,
  ...pacing.es,
  ...preshift.es,
  ...publicprofile.es,
  ...reservation.es,
  ...setup.es,
  ...team.es,
  ...venue.es,
  ...waitlist.es,
};

export const CATALOG: Record<"en" | "es", Record<MessageKey, Message>> = { en, es };
