interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    switch (new URL(request.url).pathname) {
      case "/":
      case "/moonlander":
        return env.ASSETS.fetch(request);
      default:
        return fetch(request);
    }
  },
};
