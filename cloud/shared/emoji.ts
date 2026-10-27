export interface Emoji {
	char: string;
	// Code court de `:nom:`.
	name: string;
	keywords: string;
	category: string;
}

// Une ligne par emoji : caractère, code court, mots-clés.
const DATA: Array<[string, string]> = [
	[
		'Smileys',
		`😀 grinning sourire content
		😃 smiley sourire joie
		😄 smile sourire rire
		😁 grin sourire dents
		😆 laughing rire
		😅 sweat_smile gêne rire sueur
		🤣 rofl mort de rire
		😂 joy larmes rire
		🙂 slight_smile sourire léger
		🙃 upside_down envers ironie
		😉 wink clin d'œil
		😊 blush rougir timide
		😇 innocent ange auréole
		🥰 smiling_hearts amour cœurs
		😍 heart_eyes amour yeux cœurs
		🤩 star_struck étoiles émerveillé
		😘 kissing_heart bisou
		😋 yum miam délicieux
		😛 stuck_out_tongue langue
		😜 winking_tongue langue clin
		🤪 zany fou
		😝 squinting_tongue langue
		🤑 money_mouth argent
		🤗 hugging câlin
		🤭 hand_over_mouth oups
		🤫 shushing chut silence
		🤔 thinking réfléchir pensif
		🤐 zipper_mouth bouche cousue
		🤨 raised_eyebrow sourcil doute
		😐 neutral neutre
		😑 expressionless inexpressif
		😶 no_mouth sans voix
		😏 smirk narquois
		😒 unamused blasé
		🙄 eye_roll yeux au ciel
		😬 grimacing grimace gêne
		😌 relieved soulagé
		😔 pensive triste pensif
		😪 sleepy somnolent
		🤤 drooling bave
		😴 sleeping dormir sommeil
		😷 mask masque malade
		🤒 thermometer_face fièvre malade
		🤕 head_bandage blessé
		🤢 nauseated nausée
		🤮 vomiting vomir
		🥵 hot chaud
		🥶 cold froid
		🥴 woozy étourdi
		😵 dizzy_face vertige
		🤯 exploding_head explosion choqué
		🤠 cowboy
		🥳 partying fête
		😎 sunglasses cool lunettes
		🤓 nerd intello
		🧐 monocle enquête
		😕 confused confus
		😟 worried inquiet
		🙁 slight_frown déçu
		😮 open_mouth surpris
		😯 hushed étonné
		😲 astonished stupéfait
		😳 flushed rougir gêne
		🥺 pleading supplier
		😦 frowning
		😧 anguished angoisse
		😨 fearful peur
		😰 anxious anxieux sueur
		😥 sad_relieved triste
		😢 cry pleurer larme
		😭 sob sanglot pleurer
		😱 scream hurler peur
		😖 confounded
		😣 persevere
		😞 disappointed déçu
		😓 sweat sueur
		😩 weary épuisé
		😫 tired_face fatigué
		🥱 yawning bâiller
		😤 triumph frustré
		😡 rage rage colère
		😠 angry colère fâché
		🤬 cursing jurons
		😈 smiling_imp diable
		💀 skull crâne mort
		💩 poop caca
		🤡 clown
		👻 ghost fantôme
		👽 alien extraterrestre
		🤖 robot
		😺 smiley_cat chat
		😹 joy_cat chat rire`,
	],
	[
		'Personnes',
		`👋 wave salut coucou bonjour
		🤚 raised_back_of_hand main
		✋ raised_hand main stop
		🖖 vulcan
		👌 ok_hand ok parfait
		🤌 pinched_fingers
		🤏 pinching petit
		✌️ v victoire paix
		🤞 crossed_fingers croiser doigts chance
		🤟 love_you
		🤘 metal rock
		🤙 call_me appelle
		👈 point_left gauche
		👉 point_right droite
		👆 point_up haut
		👇 point_down bas
		☝️ point_up_2 index
		👍 thumbsup +1 pouce oui d'accord
		👎 thumbsdown -1 pouce non
		✊ fist poing
		👊 punch coup de poing
		🤛 left_fist
		🤜 right_fist
		👏 clap applaudir bravo
		🙌 raised_hands hourra
		👐 open_hands
		🤲 palms_up
		🤝 handshake poignée de main accord
		🙏 pray merci prière
		✍️ writing écrire
		💪 muscle force
		🧠 brain cerveau
		👀 eyes yeux regarder
		👁️ eye œil
		👄 lips bouche
		🫡 salute salut respect
		🫶 heart_hands cœur mains
		🤷 shrug bof
		🤦 facepalm consterné
		🙋 raising_hand moi question
		🙅 no_gesture non
		🙆 ok_gesture ok
		🙇 bow incliner désolé
		💁 tipping_hand info
		🏃 runner courir
		🚶 walking marcher
		💃 dancer danser
		🕺 man_dancing danser
		👶 baby bébé
		🧑‍💻 technologist développeur ordinateur
		🥷 ninja`,
	],
	[
		'Cœurs',
		`❤️ heart cœur amour rouge
		🧡 orange_heart orange
		💛 yellow_heart jaune
		💚 green_heart vert
		💙 blue_heart bleu
		💜 purple_heart violet
		🖤 black_heart noir
		🤍 white_heart blanc
		🤎 brown_heart marron
		💔 broken_heart cœur brisé
		❣️ heart_exclamation
		💕 two_hearts
		💞 revolving_hearts
		💓 heartbeat
		💗 heartpulse
		💖 sparkling_heart
		💘 cupid
		💝 gift_heart
		💯 100 cent parfait
		💢 anger
		💥 boom explosion
		💫 dizzy étourdi
		💦 sweat_drops gouttes
		💨 dash vite
		💬 speech_balloon bulle message
		💭 thought_balloon pensée
		💤 zzz dormir`,
	],
	[
		'Nature',
		`🐶 dog chien
		🐱 cat chat
		🐭 mouse souris
		🐰 rabbit lapin
		🦊 fox renard
		🐻 bear ours
		🐼 panda
		🐨 koala
		🐯 tiger tigre
		🦁 lion
		🐮 cow vache
		🐷 pig cochon
		🐸 frog grenouille
		🐵 monkey singe
		🙈 see_no_evil singe
		🙉 hear_no_evil singe
		🙊 speak_no_evil singe
		🐔 chicken poule
		🐧 penguin pingouin manchot
		🐦 bird oiseau
		🦆 duck canard
		🦉 owl hibou
		🐺 wolf loup
		🐴 horse cheval
		🦄 unicorn licorne
		🐝 bee abeille
		🐛 bug insecte bogue
		🦋 butterfly papillon
		🐌 snail escargot lent
		🐞 ladybug coccinelle
		🐢 turtle tortue
		🐍 snake serpent
		🐙 octopus pieuvre
		🐟 fish poisson
		🐬 dolphin dauphin
		🐳 whale baleine
		🦈 shark requin
		🐘 elephant éléphant
		🦒 giraffe girafe
		🌵 cactus
		🌲 evergreen_tree sapin arbre
		🌴 palm_tree palmier
		🍀 four_leaf_clover trèfle chance
		🍁 maple_leaf érable
		🍂 fallen_leaf feuille automne
		🌷 tulip tulipe fleur
		🌹 rose fleur
		🌻 sunflower tournesol
		🌸 cherry_blossom fleur cerisier
		🌞 sun_face soleil
		☀️ sunny soleil
		🌙 moon lune
		⭐ star étoile
		🌟 star2 étoile brillante
		✨ sparkles étincelles nouveau
		⚡ zap éclair
		🔥 fire feu
		🌈 rainbow arc-en-ciel
		☁️ cloud nuage
		🌧️ rain pluie
		❄️ snowflake neige flocon
		☃️ snowman bonhomme neige
		🌊 ocean vague mer
		💧 droplet goutte eau`,
	],
	[
		'Nourriture',
		`🍏 green_apple pomme
		🍎 apple pomme
		🍐 pear poire
		🍊 tangerine orange mandarine
		🍋 lemon citron
		🍌 banana banane
		🍉 watermelon pastèque
		🍇 grapes raisin
		🍓 strawberry fraise
		🍒 cherries cerises
		🍑 peach pêche
		🥭 mango mangue
		🍍 pineapple ananas
		🥥 coconut noix coco
		🥑 avocado avocat
		🍅 tomato tomate
		🥕 carrot carotte
		🌽 corn maïs
		🌶️ hot_pepper piment
		🥦 broccoli brocoli
		🥐 croissant
		🥖 baguette pain
		🍞 bread pain
		🧀 cheese fromage
		🥚 egg œuf
		🍳 cooking cuisine poêle
		🥞 pancakes crêpes
		🥓 bacon
		🍔 hamburger burger
		🍟 fries frites
		🍕 pizza
		🌭 hotdog
		🥪 sandwich
		🌮 taco
		🌯 burrito
		🥗 salad salade
		🍝 spaghetti pâtes
		🍜 ramen nouilles
		🍣 sushi
		🍤 shrimp crevette
		🍦 icecream glace
		🍩 doughnut donut beignet
		🍪 cookie biscuit
		🎂 birthday gâteau anniversaire
		🍰 cake gâteau
		🧁 cupcake
		🍫 chocolate chocolat
		🍬 candy bonbon
		🍿 popcorn
		☕ coffee café
		🍵 tea thé
		🧃 juice jus
		🥤 cup_with_straw soda
		🍺 beer bière
		🍻 beers santé bières
		🥂 champagne_glass trinquer
		🍷 wine vin
		🍸 cocktail
		🍾 champagne bouteille fête`,
	],
	[
		'Activités et voyages',
		`⚽ soccer football foot
		🏀 basketball basket
		🏈 football_us
		⚾ baseball
		🎾 tennis
		🏐 volleyball
		🏉 rugby
		🎱 8ball billard
		🏓 ping_pong
		🏸 badminton
		🥊 boxing boxe
		⛳ golf
		🎣 fishing pêche
		🎿 ski
		🏆 trophy trophée victoire
		🥇 first_place médaille or premier
		🥈 second_place argent
		🥉 third_place bronze
		🏅 medal médaille
		🎯 dart cible objectif
		🎮 video_game jeu manette
		🕹️ joystick
		🎲 game_die dé
		🧩 puzzle
		♟️ chess échecs
		🎨 art peinture
		🎬 clapper cinéma film
		🎤 microphone micro chanter
		🎧 headphones casque musique
		🎵 musical_note note musique
		🎶 notes musique
		🎸 guitar guitare
		🎹 piano
		🥁 drum batterie
		🎉 tada fête bravo
		🎊 confetti_ball confettis
		🎈 balloon ballon
		🎁 gift cadeau
		🚀 rocket fusée lancement
		✈️ airplane avion
		🚗 car voiture
		🚕 taxi
		🚌 bus
		🚲 bike vélo
		🚂 train
		🚢 ship bateau
		⛵ sailboat voilier
		🏠 house maison
		🏢 office bureau immeuble
		🏰 castle château
		🗼 tokyo_tower tour
		🗽 statue_of_liberty statue
		🏖️ beach plage vacances
		⛰️ mountain montagne
		🏕️ camping
		🌍 earth terre monde
		🗺️ map carte
		🧭 compass boussole`,
	],
	[
		'Objets',
		`⌚ watch montre
		📱 iphone téléphone portable
		💻 computer ordinateur
		⌨️ keyboard clavier
		🖥️ desktop écran
		🖨️ printer imprimante
		🖱️ mouse_computer souris
		💾 floppy disquette sauvegarder
		💿 cd disque
		📷 camera appareil photo
		🎥 movie_camera caméra
		📺 tv télévision
		📻 radio
		⏰ alarm_clock réveil
		⏳ hourglass sablier attente
		⌛ hourglass_done
		📡 satellite antenne
		🔋 battery batterie
		🔌 plug prise
		💡 bulb idée ampoule
		🔦 flashlight lampe
		🕯️ candle bougie
		💸 money_wings argent dépense
		💵 dollar billet
		💶 euro billet
		💰 moneybag argent sac
		💳 credit_card carte bancaire
		💎 gem diamant
		⚖️ scales balance justice
		🔧 wrench clé outil
		🔨 hammer marteau
		🛠️ tools outils
		⚙️ gear engrenage réglages
		🔩 nut_and_bolt
		🧰 toolbox boîte outils
		🧲 magnet aimant
		🔬 microscope
		🔭 telescope télescope
		💊 pill médicament
		💉 syringe seringue
		🧪 test_tube éprouvette test
		🧹 broom balai
		🛒 cart caddie courses
		🚪 door porte
		🔑 key clé
		🔒 lock cadenas verrouillé
		🔓 unlock déverrouillé
		🛡️ shield bouclier
		🗡️ dagger
		📦 package colis paquet livraison
		📫 mailbox boîte lettres
		✉️ envelope enveloppe mail
		📧 email courriel
		📝 memo note mémo
		📄 page_facing_up document page
		📃 page_with_curl
		📑 bookmark_tabs
		📊 bar_chart graphique
		📈 chart_up hausse croissance
		📉 chart_down baisse
		📅 date date
		📆 calendar calendrier
		🗓️ spiral_calendar agenda
		📌 pushpin punaise épingle
		📍 round_pushpin lieu
		📎 paperclip trombone
		✂️ scissors ciseaux
		🖊️ pen stylo
		✏️ pencil crayon
		🔍 mag loupe recherche
		📚 books livres
		📖 book livre
		🔖 bookmark marque-page
		🏷️ label étiquette
		🗑️ wastebasket poubelle
		📁 file_folder dossier
		🗂️ dividers classeur
		🔗 link lien
		📣 mega mégaphone annonce
		📢 loudspeaker haut-parleur annonce
		🔔 bell cloche notification
		🔕 no_bell silencieux
		🎓 graduation diplôme
		👑 crown couronne roi
		💼 briefcase mallette travail
		🎒 backpack sac dos
		👓 glasses lunettes`,
	],
	[
		'Symboles',
		`✅ white_check_mark coche fait valider oui
		☑️ ballot_box_with_check case cochée
		✔️ heavy_check_mark coche
		❌ x croix non erreur
		❎ negative_squared_cross croix
		➕ heavy_plus_sign plus
		➖ heavy_minus_sign moins
		➗ heavy_division_sign division
		✖️ heavy_multiplication_x multiplier
		❓ question interrogation
		❔ grey_question interrogation
		❗ exclamation important
		‼️ bangbang exclamation
		⚠️ warning attention avertissement
		🚫 no_entry_sign interdit
		⛔ no_entry sens interdit
		🛑 stop arrêt
		🚧 construction travaux
		♻️ recycle recyclage
		🔴 red_circle rouge
		🟠 orange_circle orange
		🟡 yellow_circle jaune
		🟢 green_circle vert
		🔵 blue_circle bleu
		🟣 purple_circle violet
		⚫ black_circle noir
		⚪ white_circle blanc
		🟥 red_square carré rouge
		🟩 green_square carré vert
		🟦 blue_square carré bleu
		🔺 small_red_triangle triangle
		🔻 small_red_triangle_down triangle
		➡️ arrow_right flèche droite
		⬅️ arrow_left flèche gauche
		⬆️ arrow_up flèche haut
		⬇️ arrow_down flèche bas
		↩️ leftwards_arrow_with_hook retour
		🔄 arrows_counterclockwise actualiser
		🔁 repeat répéter
		🔀 twisted_rightwards_arrows aléatoire
		▶️ arrow_forward lecture
		⏸️ pause
		⏹️ stop_button
		⏩ fast_forward avance rapide
		🆕 new nouveau
		🆗 ok
		🆒 cool
		🆓 free gratuit
		🆘 sos aide
		ℹ️ information info
		©️ copyright
		®️ registered marque
		™️ tm marque
		#️⃣ hash dièse
		🔢 1234 nombres
		🕐 clock1 heure
		💲 heavy_dollar_sign dollar
		🏁 checkered_flag drapeau arrivée
		🚩 triangular_flag drapeau
		🏳️ white_flag drapeau blanc
		🏴 black_flag drapeau noir
		🏳️‍🌈 rainbow_flag fierté
		🇫🇷 fr france drapeau
		🇪🇺 eu europe drapeau
		🇧🇪 be belgique drapeau
		🇨🇭 ch suisse drapeau
		🇨🇦 ca canada drapeau`,
	],
];

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const EMOJIS: Emoji[] = DATA.flatMap(([category, block]) =>
	block
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [char = '', name = '', ...keywords] = line.split(/\s+/);
			return { char, name, keywords: fold(keywords.join(' ')), category };
		}),
);

export const EMOJI_CATEGORIES = DATA.map(([category]) => category);

export const emojiByName = new Map(EMOJIS.map((e) => [e.name, e]));

export const emojiByChar = new Map(EMOJIS.map((e) => [e.char, e]));

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];

// Code court d'abord, puis mots-clés.
export function searchEmojis(query: string, limit = 48): Emoji[] {
	const q = fold(query.trim());
	if (!q) {
		return [];
	}
	const scored: Array<[number, Emoji]> = [];
	for (const emoji of EMOJIS) {
		const score = emoji.name.startsWith(q)
			? 0
			: emoji.name.includes(q)
				? 1
				: emoji.keywords.split(' ').some((k) => k.startsWith(q))
					? 2
					: emoji.keywords.includes(q)
						? 3
						: -1;
		if (score >= 0) {
			scored.push([score, emoji]);
		}
	}
	return scored
		.sort((a, b) => a[0] - b[0])
		.slice(0, limit)
		.map(([, emoji]) => emoji);
}
