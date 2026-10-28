import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { useRef, type RefObject } from 'react';

import type { Member } from '../../../shared/types';
import { Floating } from '../../floating';
import { Avatar, Icon, type IconName } from '../../ui';

export type Block = { id: string; label: string; hint: string; icon: IconName | null; mark?: string; keywords: string; run: (editor: Editor, range: Range) => void };

export type MenuItem = { kind: 'block'; block: Block } | { kind: 'member'; member: Member };

export type MenuState = { kind: 'slash' | 'mention'; items: MenuItem[]; index: number; rect: DOMRect | null; pick: (item: MenuItem) => void } | null;

const fold = (s: string) =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();

// Pont entre le cycle de vie des suggestions TipTap et un état React.
export function suggestionRender(kind: 'slash' | 'mention', set: (next: MenuState | ((prev: MenuState) => MenuState)) => void, current: RefObject<MenuState>) {
	return () => {
		const show = (props: SuggestionProps<MenuItem, MenuItem>, keep: boolean) =>
			set((prev) => ({
				kind,
				items: props.items,
				index: keep && prev ? Math.min(prev.index, Math.max(0, props.items.length - 1)) : 0,
				rect: props.clientRect?.() ?? null,
				pick: (item) => props.command(item),
			}));
		return {
			onStart: (props: SuggestionProps<MenuItem, MenuItem>) => show(props, false),
			onUpdate: (props: SuggestionProps<MenuItem, MenuItem>) => show(props, true),
			onKeyDown: ({ event }: { event: KeyboardEvent }) => {
				const menu = current.current;
				if (!menu || !menu.items.length) {
					return false;
				}
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					const step = event.key === 'ArrowDown' ? 1 : -1;
					set({ ...menu, index: (menu.index + step + menu.items.length) % menu.items.length });
					return true;
				}
				if (event.key === 'Enter' || event.key === 'Tab') {
					menu.pick(menu.items[menu.index]!);
					return true;
				}
				if (event.key === 'Escape') {
					set(null);
					return true;
				}
				return false;
			},
			onExit: () => set(null),
		};
	};
}

export function slashExtension(blocks: () => Block[], render: SuggestionOptions<MenuItem, MenuItem>['render']) {
	return Extension.create({
		name: 'canvasSlash',
		addProseMirrorPlugins() {
			return [
				Suggestion<MenuItem, MenuItem>({
					editor: this.editor,
					char: '/',
					pluginKey: new PluginKey('canvasSlash'),
					items: ({ query }) => {
						const q = fold(query);
						return blocks()
							.filter((b) => !q || fold(`${b.label} ${b.keywords}`).includes(q))
							.map((block) => ({ kind: 'block', block }));
					},
					command: ({ editor, range, props }) => {
						if (props.kind === 'block') {
							props.block.run(editor, range);
						}
					},
					render,
				}),
			];
		},
	});
}

export const memberItems = (members: Iterable<Member>, query: string): MenuItem[] => {
	const q = fold(query);
	return [...members]
		.filter((m) => !q || fold(m.name).includes(q))
		.slice(0, 8)
		.map((member) => ({ kind: 'member', member }));
};

export function SuggestionMenu({ menu, onHover }: { menu: NonNullable<MenuState>; onHover: (index: number) => void }) {
	const anchor = useRef<HTMLSpanElement>(null);
	const rect = menu.rect;
	return (
		<>
			<span ref={anchor} className='canvas-caret-anchor' style={rect ? { left: rect.left, top: rect.top, height: rect.height } : { display: 'none' }} />
			{rect && (
				<Floating anchor={anchor} placement='bottom-start' className='popover canvas-menu' role='listbox' aria-label={menu.kind === 'slash' ? 'Insérer un bloc' : 'Mentionner'}>
					{menu.items.length === 0 ? (
						<p className='canvas-menu-empty'>{menu.kind === 'slash' ? 'Aucun bloc ne correspond' : 'Personne ne correspond'}</p>
					) : (
						menu.items.map((item, i) => (
							<button
								key={item.kind === 'block' ? item.block.id : item.member.id}
								type='button'
								role='option'
								aria-selected={i === menu.index}
								className='menu-item canvas-menu-item'
								onMouseDown={(e) => e.preventDefault()}
								onMouseEnter={() => onHover(i)}
								onClick={() => menu.pick(item)}
							>
								{item.kind === 'block' ? (
									<>
										<span className='canvas-menu-glyph'>{item.block.icon ? <Icon name={item.block.icon} size={16} /> : item.block.mark}</span>
										<span className='grow'>
											<span className='canvas-menu-label'>{item.block.label}</span>
											<span className='canvas-menu-hint'>{item.block.hint}</span>
										</span>
									</>
								) : (
									<>
										<Avatar name={item.member.name} url={item.member.avatarUrl} size={22} />
										<span className='grow ellipsis'>{item.member.name}</span>
									</>
								)}
							</button>
						))
					)}
				</Floating>
			)}
		</>
	);
}
