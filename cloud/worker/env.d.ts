declare namespace Cloudflare {
	interface Env {
		// Secret optionnel : absent = client public PKCE.
		RECUBE_CLIENT_SECRET?: string;
	}
}
