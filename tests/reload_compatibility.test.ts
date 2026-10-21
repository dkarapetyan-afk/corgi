/** Run with CORGI_OLD_EXE pointing to a protocol-1 test build. */
import { Runtime, EXE } from "./runtime";
import { Pty, registerCase, run } from "./support";

class ReloadCompatibility extends Runtime {
  async configure() {
    await run([process.env.CORGI_OLD_EXE!, "start"], { env: this.env });
  }
  async upgrade(command: "dev" | "reload") {
    this.assertEqual((await this.rpc({ op: "hello", protocol: 1 })).protocol, 1);
    const old = await this.rpc({ op: "session.snapshot", protocol: 1 });
    const pane = (
      await this.rpc({
        op: "session.command",
        protocol: 1,
        command: { "pane.create": { workspace: old.workspaces[0].id, command: "exec /bin/sh" } },
      })
    ).result.pane;
    const before = await this.rpc({ op: "session.snapshot", protocol: 1 });
    if (command === "dev") {
      this.pty = await Pty.spawn([EXE, "dev"], { env: this.env, cols: 80, rows: 24 });
      this.proc = this.pty.proc;
      await this.until(async () => (await this.rpc({ op: "viewer.list" })).viewers.length > 0);
    } else await this.run_cli("reload");
    const after = await this.session();
    this.assertNotEqual(after.server_pid, before.server_pid);
    this.assertEqual(after.panes.find((p: any) => p.id === pane).pid, before.panes.find((p: any) => p.id === pane).pid);
    await this.command("pane.input", { target: pane, data: "printf 'CROSS_VERSION_ALIVE\\n'\r" });
    await this.until(async () =>
      (await this.command("pane.read", { target: pane, view: "screen" })).text.includes("CROSS_VERSION_ALIVE"),
    );
  }
  async test_dev_upgrades_protocol_one_and_attaches() {
    await this.upgrade("dev");
  }
  async test_explicit_reload_upgrades_protocol_one() {
    await this.upgrade("reload");
  }
}
registerCase("ReloadCompatibility", ReloadCompatibility, {
  skipTests: process.env.CORGI_OLD_EXE
    ? {}
    : {
        test_dev_upgrades_protocol_one_and_attaches: "requires a protocol-1 CORGI_OLD_EXE",
        test_explicit_reload_upgrades_protocol_one: "requires a protocol-1 CORGI_OLD_EXE",
      },
});
