//! Claude Code's own first-run sign-in, read off its screen so `corgi account
//! add` can frame it. It asks for a theme, then how to sign in, then shows a
//! link and waits for a code the page may give.
import type { Signin } from "../adapter";
import { onboarded } from "./info";

export const signin: Signin = {
  // Its first screen comes up at once.
  started: text => /\S/.test(text),
  step(text) {
    if (text.includes("Paste code here if prompted")) return "code";
    if (text.includes("Select login method")) return "method";
    return null;
  },
  hints: { code: "Sign in on the page as the account you're adding. If it shows a code, paste it here." },
  ready: onboarded,
  check: ["auth", "status"],
  logout: ["auth", "logout"],
  first: [],
  // Signed out after its first run, it says to run /login.
  again: null,
};
