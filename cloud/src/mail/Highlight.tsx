import { SEARCH_MARK } from '../../shared/mail';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const searchTerms = (query: string) =>
	query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length >= 2)
		.slice(0, 8);

const SERVER_RE = new RegExp(`${SEARCH_MARK[0]}([^${SEARCH_MARK[1]}]*)${SEARCH_MARK[1]}`);

// Bornes posées par le serveur d'abord, puis termes de la requête côté client.
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
	const local = terms.length ? new RegExp(`(${terms.map(escape).join('|')})`, 'i') : null;
	const parts = text.split(SERVER_RE);
	return (
		<>
			{parts.map((part, i) =>
				i % 2 === 1 ? (
					<mark key={i} className='mail-hit'>
						{part}
					</mark>
				) : local ? (
					part.split(local).map((piece, j) =>
						j % 2 === 1 ? (
							<mark key={`${i}-${j}`} className='mail-hit'>
								{piece}
							</mark>
						) : (
							piece
						),
					)
				) : (
					part
				),
			)}
		</>
	);
}

export const stripMarks = (text: string) => text.split(SEARCH_MARK[0]).join('').split(SEARCH_MARK[1]).join('');
