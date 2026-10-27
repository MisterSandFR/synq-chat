import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { P, has } from '../../../shared/permissions';
import type { Channel, Member, VoiceParticipant, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Dialog } from '../../ui';
import type { ContextMenuItem } from '../ContextMenu';
import { assignableGrades, canKickMember, canManageMember, outranks } from '../grades';
import './members.css';

export const MENTION_EVENT = 'synq:mention';

export type MentionDetail = { channelId: string; text: string };

// Membre en cours de glisser : `dataTransfer` est illisible pendant le survol.
export const voiceDrag: { userId: string | null } = { userId: null };

export type MemberMenu = {
	items: (userId: string) => ContextMenuItem[];
	canDrag: (userId: string) => boolean;
	canMove: (userId: string, channelId: string) => boolean;
	move: (userId: string, channelId: string) => void;
	node: ReactNode;
};

type Options = {
	workspaceId: string;
	info: WorkspaceDetail | null;
	channels: Channel[];
	perms: Record<string, number>;
	voice: Record<string, VoiceParticipant[]>;
	myId: string;
	// Salon dont le composer reçoit la mention, null s'il n'y en a pas.
	mentionChannelId: string | null;
	onProfile: (userId: string, rect: DOMRect) => void;
	onMessage: (userId: string) => void;
	onChanged: () => Promise<unknown>;
};

export function useMemberMenu({ workspaceId, info, channels, perms, voice, myId, mentionChannelId, onProfile, onMessage, onChanged }: Options): MemberMenu {
	const [grading, setGrading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const point = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
	const members = useMemo(() => new Map((info?.members ?? []).map((m) => [m.id, m])), [info]);

	// Position du dernier clic : ancre de la carte de profil ouverte depuis le menu.
	useEffect(() => {
		const track = (e: PointerEvent) => {
			point.current = { x: e.clientX, y: e.clientY };
		};
		window.addEventListener('pointerdown', track, true);
		return () => window.removeEventListener('pointerdown', track, true);
	}, []);

	useEffect(() => {
		if (!error) {
			return;
		}
		const timer = window.setTimeout(() => setError(null), 5000);
		return () => window.clearTimeout(timer);
	}, [error]);

	const report = (request: Promise<unknown>) => request.then(() => setError(null), (err) => setError(errorText(err)));

	const voiceOf = (userId: string) => {
		for (const [channelId, list] of Object.entries(voice)) {
			const participant = list.find((p) => p.userId === userId);
			if (participant) {
				return { channelId, participant };
			}
		}
		return null;
	};

	const moveTargets = (userId: string) => {
		const member = members.get(userId);
		const current = voiceOf(userId);
		if (!info || !member || !current || !has(perms[current.channelId] ?? 0, P.VOICE_MOVE) || (userId !== myId && !outranks(info, member))) {
			return [];
		}
		return channels.filter((c) => c.kind === 'voice' && c.id !== current.channelId && has(perms[c.id] ?? 0, P.VOICE_MOVE));
	};

	const move = (userId: string, channelId: string) => void report(api('POST', `/w/${workspaceId}/voice/move`, { userId, channelId }));
	const moderate = (userId: string, action: 'mute' | 'kick') => void report(api('POST', `/w/${workspaceId}/voice/moderate`, { userId, action }));

	const items = (userId: string): ContextMenuItem[] => {
		const member = members.get(userId);
		if (!info || !member) {
			return [];
		}
		const self = userId === myId;
		const current = voiceOf(userId);
		const canModerate = !self && current !== null && has(perms[current.channelId] ?? 0, P.VOICE_MODERATE) && outranks(info, member);
		const list: ContextMenuItem[] = [{ label: 'Voir le profil', icon: 'user', onSelect: () => onProfile(userId, new DOMRect(point.current.x, point.current.y, 0, 0)) }];
		if (!self) {
			list.push({ label: 'Envoyer un message direct', icon: 'chat', onSelect: () => onMessage(userId) });
		}
		if (mentionChannelId) {
			const detail: MentionDetail = { channelId: mentionChannelId, text: `@${member.name} ` };
			list.push({ label: 'Mentionner', icon: 'at', onSelect: () => window.dispatchEvent(new CustomEvent(MENTION_EVENT, { detail })) });
		}
		if (canManageMember(info, member, myId) && assignableGrades(info).length > 0) {
			list.push({ label: 'Gérer les grades', icon: 'shield', onSelect: () => setGrading(userId) });
		}
		if (canModerate) {
			list.push('sep', { label: 'Couper son micro', icon: 'mic-off', disabled: current.participant.muted, onSelect: () => moderate(userId, 'mute') });
			list.push({ label: 'Retirer du vocal', icon: 'hangup', danger: true, onSelect: () => moderate(userId, 'kick') });
		}
		const targets = moveTargets(userId);
		if (targets.length) {
			list.push('sep', ...targets.map((c): ContextMenuItem => ({ label: `Déplacer vers ${c.name}`, icon: 'speaker', onSelect: () => move(userId, c.id) })));
		}
		if (canKickMember(info, member, myId)) {
			list.push('sep', {
				label: 'Exclure de l’espace',
				icon: 'logout',
				danger: true,
				onSelect: () => {
					if (window.confirm(`Exclure ${member.name} de l’espace ?`)) {
						void report(api('DELETE', `/w/${workspaceId}/members/${userId}`).then(onChanged));
					}
				},
			});
		}
		return list;
	};

	const graded = grading ? members.get(grading) : undefined;
	const node = (
		<>
			{info && graded && <GradesDialog info={info} member={graded} onClose={() => setGrading(null)} onChanged={onChanged} />}
			{error && (
				<p className='notice notice-error member-toast' role='alert'>
					{error}
				</p>
			)}
		</>
	);

	return {
		items,
		canDrag: (userId) => moveTargets(userId).length > 0,
		canMove: (userId, channelId) => moveTargets(userId).some((c) => c.id === channelId),
		move,
		node,
	};
}

function GradesDialog({ info, member, onClose, onChanged }: { info: WorkspaceDetail; member: Member; onClose: () => void; onChanged: () => Promise<unknown> }) {
	const [error, setError] = useState<string | null>(null);
	const grades = assignableGrades(info).sort((a, b) => b.position - a.position);
	const toggle = (gradeId: string, on: boolean) => {
		setError(null);
		const gradeIds = on ? [...member.gradeIds, gradeId] : member.gradeIds.filter((id) => id !== gradeId);
		api('PUT', `/w/${info.id}/members/${member.id}/grades`, { gradeIds })
			.then(onChanged)
			.catch((err) => setError(errorText(err)));
	};
	return (
		<Dialog open onClose={onClose} title={`Grades de ${member.name}`}>
			<div className='member-grades'>
				{grades.map((grade) => (
					<label key={grade.id} className='check member-grade'>
						<input type='checkbox' checked={member.gradeIds.includes(grade.id)} onChange={(e) => toggle(grade.id, e.target.checked)} />
						<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
						<span style={{ color: grade.color || undefined }}>{grade.name}</span>
					</label>
				))}
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
		</Dialog>
	);
}
