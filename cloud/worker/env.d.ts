// Secrets : absents en local et en test, d'où les gardes à l'exécution.
interface Env {
	RECUBE_CLIENT_SECRET: string;
	REALTIME_APP_SECRET: string;
	TURN_KEY_SECRET: string;
	MAIL_KEY: string;
}
