# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/upnp/                         UPnP layer, no dependency: xml.js (reader), http.js (bounded fetch),
                                  soap.js, description.js (SSDP, descriptions, SCPD), didl.js,
                                  renderer.js (AVTransport, RenderingControl), server.js (ContentDirectory),
                                  icy.js (web radio name from its ICY headers)
src/registry.js                   description URL → known devices, capabilities, cached clients
src/discovery.js                  mediated SSDP scan + manual URLs + created devices → Discovery tab
src/devices/                      renderer.js / server.js discovery payloads, index.js ids and params
src/poller.js                     renderer polling, commands, play queue, scene triggers
src/states.js                     publish only the changed states
src/actions.js, scenes.js, widgets.js  manifest actions, scene actions, the "player" and "favorites" widgets
src/favorites.js, playback.js     favorites of the configuration; what scenes, favorites and widgets share
src/i18n.js, messages.js, errors.js  languages (en, fr, de, es), user messages, UPnP refusals
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test; helpers/fakeNetwork.js serves fixtures/devices/
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German and Spanish (the
  languages of Gladys): action messages, manifest texts, widget contents,
  errors. `test/i18n.test.js` fails on a missing or empty language. German
  says "du" (never "Sie"/"Ihr…", checked by the same test), Spanish "usted". The user
  documentation stays `docs/en.md` / `docs/fr.md`, kept in sync: the store
  only re-hosts these two.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Appris sur l'intégration DLNA**

- **Découverte SSDP médiée : le cœur ne scanne que la PREMIÈRE entrée `ssdp`** du manifeste
  (`runScan.js`, « first-match »). Déclarer `MediaRenderer:1` puis `MediaServer:1` ne cherche
  jamais les serveurs : une seule entrée `upnp:rootdevice`, puis lire chaque description (appareils
  embarqués compris).
- **Le conteneur principal n'a aucun port entrant** (spec `container-descriptor.md`) : un
  abonnement UPnP GENA, ou tout rappel HTTP d'un appareil du LAN, est impossible. Interroger.
- Le proxy du cœur pour les intégrations externes **ne transmet pas les `options` de `setValue`** :
  le volume de l'action « Diffuser une notification » est perdu ; la valeur reçue est l'URL MP3
  (chaîne) sur une fonctionnalité `music/play_notification`.
- Les fonctionnalités `music/*` **ne s'affichent pas** dans la carte « appareils de la pièce » (seul
  le widget Musique les lit) ; les touches `television/*` s'y affichent en boutons poussoirs.
- Un bouton de widget `device_feature` sur une commande poussoir reste **teinté « actif » pour
  toujours** (le cœur garde `last_value` = valeur envoyée) : passer par des actions de widget.
- Un appareil **sans aucune fonctionnalité** est accepté de bout en bout (`setDiscoveredDevices`
  n'exige qu'un tableau, `device.create` prend `features || []`, la Découverte affiche « aucune
  fonctionnalité ») et il figure dans les listes `source: "devices"` : c'est le cas des serveurs.
- Une action de scène qui parcourt un serveur doit s'arrêter **avant** son `timeout_seconds` : le
  cœur abandonne, mais le conteneur continuerait. Échéance globale (`withDeadline`) sous ce délai.
- **Test réel Denon AVR-S650H, depuis la veille** (mesuré) : SetAVTransportURI et Play en 200 à
  t=1 s, état vide de 6 à 12 s, puis STOPPED avec l'URI chargée, et **tous les Play ignorés**
  (200 quand même) jusqu'à ~51 s ; TRANSITIONING à 53 s, PLAYING à 57 s. Éveillé : PLAYING en ~5 s.
  Suivre le démarrage en arrière-plan (`ensurePlaying` : 75 s, Play toutes les 5 s sans plafond),
  sans jamais contrarier une commande arrivée entre-temps ; une action de scène répond dès que
  Play est accepté (limite de 90 s). Le https marche :
  ne pas conclure d'un STOPPED sans savoir si l'appareil sortait de veille. Il décrit un artiste ou
  un album inconnu par `""` (deux guillemets) : `cleanText` les vide.
- `publishStates` (lot) : un état texte part dans `text`, pas dans `state`.
- **Favoris** : groupes de champs numérotés `favorite_<n>_<champ>` (le `config_schema` n'a pas de
  liste). Le serveur d'un favori est un **nom** (champ texte), pas un `select` `source: "devices"` :
  voir le piège 422 plus bas.
- **Nom d'une radio web** : `icy-name` du flux, demandé par `Icy-MetaData: 1` (une requête, 2,5 s,
  au plus le premier bloc de métadonnées, puis coupée), sinon le `StreamTitle` du premier bloc,
  sinon l'URL. Seulement quand aucun titre n'est donné : la notification du cœur passe « Gladys ».
- SDK 0.15.0 : `publishChangedStates` et `@gladysassistant/integration-sdk/testing` existent.
  `StatePublisher` (src/states.js) est gardé (il marche, `remember` sert après une commande) ; le
  faux Gladys du SDK sert dans `test/polling.test.js` (`scriptedDenon({ gladys })`), le faux maison
  `test/helpers/fakeGladys.js` reste pour le reste des tests.
- **Polling (#3198)** : les renderers sont publiés en `should_poll: false` et sondés par le
  minuteur de `RendererManager` (lancé par `sync()` à la connexion et à chaque création
  d'appareil) ; `onPoll` n'est qu'un repli. Le cœur 5.2.0 ne sonderait de toute façon jamais un
  appareil créé sans `should_poll`. `test/polling.test.js` le vérifie sans jamais appeler `onPoll`.
- **Logs** : en info, seulement le cycle de vie (démarrage, renderer perdu / retrouvé, résumé de
  découverte quand il change) et une ligne par action de l'utilisateur. Une erreur qui se répète à
  chaque sondage ou à chaque scan de fond (états refusés, SSDP indisponible) : une ligne au début,
  une au retour, le reste en debug (`LOG_LEVEL=debug`). Les URL passent par `loggableUrl` (ni
  identifiants ni paramètres). `test/polling.test.js` vérifie qu'un cycle normal n'écrit rien en
  info.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- **Un `select` de `config_schema` doit toujours valoir une de ses options** : le cœur
  (`validateConfigValue`) refuse en 422 la valeur vide (option « — » du front) comme un appareil
  supprimé d'une liste `source: "devices"`, et le front renvoie à chaque enregistrement toutes les
  valeurs stockées. Un `select` d'appareil facultatif dans la configuration bloque donc toute la
  configuration dès que l'appareil disparaît : préférer un champ texte (nom).
- **Langues** : le front existe en `en`, `fr`, `de`, `es` (repli sur `en`) ; le store ne réhéberge
  que `docs/en.md` et `docs/fr.md` (`DOCS_LANGUAGES`), et le front ouvre `docs[langue] || docs.en` :
  une doc `de`/`es` ne serait jamais lue.
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- **Erreur d'un bouton de widget** (5.1.4) : le front affiche « L'action a échoué. — » suivi du
  texte de l'erreur (chaîne, 200 caractères), sans que le conteneur connaisse la langue (le
  `widget.action` n'en transmet pas). Un message **résolu** `{ en, fr }`, lui, est traduit par le
  front (repli sur `en`). L'erreur d'une commande d'appareil revient en HTTP 400 que les cartes du
  front ignorent (simple état d'erreur), celle d'une action de scène part dans les logs de Gladys
  (`logger.warn`) : seul le widget montre le texte.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.
