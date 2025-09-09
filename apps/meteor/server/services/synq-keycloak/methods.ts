import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { synqKeycloakService } from './service';

// Méthode pour obtenir l'URL d'authentification Keycloak
Meteor.methods({
	'synq.keycloak.getAuthUrl'(state?: string) {
		check(state, Match.Maybe(String));
		
		if (!synqKeycloakService.isEnabled()) {
			throw new Meteor.Error('keycloak-not-enabled', 'Keycloak n\'est pas activé');
		}

		try {
			return synqKeycloakService.getAuthUrl(state);
		} catch (error) {
			throw new Meteor.Error('keycloak-config-error', 'Erreur de configuration Keycloak');
		}
	},

	'synq.keycloak.authenticate'(code: string) {
		check(code, String);
		
		if (!synqKeycloakService.isEnabled()) {
			throw new Meteor.Error('keycloak-not-enabled', 'Keycloak n\'est pas activé');
		}

		try {
			return synqKeycloakService.authenticateWithKeycloak(code);
		} catch (error) {
			throw new Meteor.Error('keycloak-auth-error', 'Erreur lors de l\'authentification Keycloak');
		}
	},

	'synq.keycloak.isEnabled'() {
		return synqKeycloakService.isEnabled();
	},
});
