import { expect, test } from "bun:test";
import { name } from "./process_name";

test("a program is named as tmux names a window", () => {
  expect(name(["vim", "notes.md"])).toBe("vim");
  expect(name(["/opt/homebrew/bin/htop"])).toBe("htop");
  // A path keeps its spaces; a title written over argv ends at the first.
  expect(name(["/Applications/Visual Studio Code.app/Contents/MacOS/Electron"])).toBe("Electron");
  expect(name(["npm run dev", "", ""])).toBe("npm");
  expect(name(["sshd: tal@pts/0"])).toBe("sshd");
  expect(name([])).toBe("");
});

test("a shell at its prompt is unnamed, and one running something is named for it", () => {
  for (const argv of [["-zsh"], ["fish"], ["tcsh"], ["/bin/bash", "--login"], ["zsh", "-i"]])
    expect(name(argv)).toBe("");
  expect(name(["bash", "deploy"])).toBe("deploy");
  expect(name(["/bin/sh", "./scripts/release.sh", "--dry-run"])).toBe("release");
  expect(name(["sh", "-c", "sleep 10; echo done"])).toBe("sh");
});

test("an interpreter is named for its script or module", () => {
  expect(name(["node", "/opt/homebrew/bin/npm", "run", "dev"])).toBe("npm");
  expect(name(["node", "--inspect", "node_modules/vite/bin/vite.js"])).toBe("vite");
  expect(name(["node", "-r", "ts-node/register", "server.ts"])).toBe("server");
  expect(
    name([
      "/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python",
      "manage.py",
      "runserver",
    ]),
  ).toBe("manage");
  expect(name(["python3.12", "-m", "http.server", "8000"])).toBe("http.server");
  expect(name(["bun", "run", "src/main.ts"])).toBe("main");
  // A subcommand, inline code or a bare interpreter keeps the interpreter's name.
  expect(name(["bun", "test"])).toBe("bun");
  expect(name(["bun", "run", "dev"])).toBe("bun");
  expect(name(["python3", "-c", "print(1)"])).toBe("python3");
  expect(name(["node"])).toBe("node");
  // A program merely named like one is not an interpreter.
  expect(name(["nodemon", "server.js"])).toBe("nodemon");
});
