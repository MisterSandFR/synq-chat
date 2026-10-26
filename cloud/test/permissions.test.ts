import { describe, expect, it } from 'vitest';

import { ALL_PERMS, DEFAULT_MEMBER_PERMS, P, READ_ONLY_DENY, basePerms, channelPerms, has } from '../shared/permissions';

const member = (base = DEFAULT_MEMBER_PERMS, grades: string[] = ['default']) => ({ owner: false, base, grades });

describe('calcul des permissions', () => {
	it('cumule les grades et donne tout à l’administrateur', () => {
		expect(basePerms(false, [{ permissions: P.VIEW_CHANNEL }, { permissions: P.CREATE_INVITES }])).toBe(P.VIEW_CHANNEL | P.CREATE_INVITES);
		expect(basePerms(false, [{ permissions: P.ADMINISTRATOR }])).toBe(ALL_PERMS);
		expect(basePerms(true, [])).toBe(ALL_PERMS);
	});

	it('applique la lecture seule du grade par défaut', () => {
		const perms = channelPerms(member(), { default: { allow: 0, deny: READ_ONLY_DENY } });
		expect(has(perms, P.VIEW_CHANNEL)).toBe(true);
		expect(has(perms, P.SEND_MESSAGES)).toBe(false);
	});

	it('laisse un grade autoriser ce que le défaut refuse', () => {
		const overrides = { default: { allow: 0, deny: P.VIEW_CHANNEL }, staff: { allow: P.VIEW_CHANNEL, deny: 0 } };
		expect(has(channelPerms(member(), overrides), P.VIEW_CHANNEL)).toBe(false);
		expect(has(channelPerms(member(DEFAULT_MEMBER_PERMS, ['default', 'staff']), overrides), P.VIEW_CHANNEL)).toBe(true);
	});

	it('fait primer l’autorisation sur le refus entre grades', () => {
		const overrides = { a: { allow: 0, deny: P.VOICE_SPEAK }, b: { allow: P.VOICE_SPEAK, deny: 0 } };
		expect(has(channelPerms(member(DEFAULT_MEMBER_PERMS, ['default', 'a', 'b']), overrides), P.VOICE_SPEAK)).toBe(true);
		expect(has(channelPerms(member(DEFAULT_MEMBER_PERMS, ['default', 'a']), overrides), P.VOICE_SPEAK)).toBe(false);
	});

	it('ignore les surcharges pour le propriétaire et l’administrateur', () => {
		const overrides = { default: { allow: 0, deny: ALL_PERMS } };
		expect(channelPerms({ owner: true, base: ALL_PERMS, grades: ['default'] }, overrides)).toBe(ALL_PERMS);
		expect(channelPerms(member(basePerms(false, [{ permissions: P.ADMINISTRATOR }])), overrides)).toBe(ALL_PERMS);
	});
});
