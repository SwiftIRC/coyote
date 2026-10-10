import type { RoomLink } from "../core/link";

export type RootStack = {
  Home: { message?: string } | undefined;
  PreJoin: { link: RoomLink; error?: string };
  Call: undefined;
};
