# DLNA

Pilotez depuis Gladys les lecteurs DLNA / UPnP de la maison (TV, ampli, enceinte, streamer) et
lisez le contenu de vos serveurs multimédias (Plex, Jellyfin, Emby, MiniDLNA, un NAS…). Tout reste
sur votre réseau local : ni compte, ni cloud.

## Prérequis

- Gladys 5.1.0 ou plus récent.
- Les lecteurs et serveurs sur le même réseau que Gladys. Un appareil d'un autre réseau (VLAN,
  autre sous-réseau) s'ajoute à la main, voir plus bas.
- Sur un lecteur, le DLNA doit être activé : il s'appelle parfois « DLNA », « UPnP », « Media
  renderer », « Lire sur » ou « AllShare » dans ses réglages, et certains téléviseurs ne répondent
  qu'allumés (pas en veille).

## Ajouter vos appareils

1. Installez l'intégration, puis ouvrez son onglet **Découverte** : Gladys cherche sur le réseau et
   liste les lecteurs et serveurs multimédias trouvés. Relancez la recherche avec le bouton s'il
   manque un appareil (un téléviseur doit être allumé).
2. Ajoutez les appareils voulus. Un **lecteur** reçoit les commandes de lecture ; un **serveur
   multimédia** n'a aucune fonctionnalité, mais il apparaît alors dans les actions de scène.
3. Certains appareils sont les deux : un ampli Denon, par exemple, est un lecteur et un petit
   serveur multimédia. Le serveur est alors listé avec « (serveur multimédia) » après son nom.

**Langue des noms de fonctionnalités** : Gladys garde les noms d'un appareil une fois ajouté.
Choisissez la langue dans **Configuration** avant d'ajouter les appareils.

**Un appareil introuvable** : la découverte SSDP ne fonctionne que sur le réseau de Gladys.
Trouvez l'URL de la description UPnP de l'appareil (dans la documentation de l'appareil ou du
serveur : MiniDLNA sert
`http://<adresse>:8200/rootDesc.xml`, un ampli Denon/HEOS
`http://<adresse>:60006/upnp/desc/aios_device/aios_device.xml`). Vérifiez-la avec l'action
**Tester une URL de description**, puis ajoutez-la aux **URL de description** de la configuration
et relancez la recherche.

## L'appareil lecteur

| Fonctionnalité      | Rôle                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| Lecture, Pause      | Lance ou reprend, met en pause (arrête si le lecteur ne sait pas)    |
| Stop                | Arrête la lecture                                                    |
| Précédent, Suivant  | Piste précédente ou suivante (de la file d'attente, voir plus bas)   |
| Volume              | 0 à 100 %, ramené à la plage que le lecteur déclare                  |
| Sourdine            | Active ou coupe la sourdine                                          |
| État de lecture     | 1 pendant la lecture, 0 sinon (pause, arrêt, éteint)                 |
| En cours de lecture | « Artiste — Titre » tel que le lecteur le décrit, « — » sinon        |
| Notification        | Utilisée par l'action de scène « Diffuser une notification » du cœur |

Volume et Sourdine n'apparaissent que si le lecteur les propose. L'appareil fonctionne avec le
widget **Musique** du tableau de bord (précédent, lecture/pause, suivant, volume).

L'état est rafraîchi toutes les quelques secondes pendant la lecture, toutes les 15 secondes
sinon. Un lecteur éteint affiche le badge **injoignable** et il est vérifié une fois par minute ;
s'il revient sur une autre adresse, l'intégration le retrouve seule (une recherche réseau, au plus
toutes les 5 minutes).

## Scènes

**Déclencheurs**

- **Lecture DLNA démarrée**, **Lecture DLNA en pause**, **Lecture DLNA arrêtée** : choisissez un
  lecteur, ou laissez vide pour n'importe lequel. Les actions suivantes peuvent utiliser
  `{{triggerEvent.data.renderer}}`, `{{triggerEvent.data.title}}`, `{{triggerEvent.data.artist}}`
  et `{{triggerEvent.data.album}}`. Usage typique : baisser la lumière quand la TV lance un film,
  la rallumer à l'arrêt. Un lecteur qu'on éteint ne déclenche rien (ce n'est pas un « arrêt »), pas
  plus que le court silence entre deux pistes d'une file d'attente.

**Actions**

- **Lire un serveur multimédia sur un lecteur DLNA** : choisissez le lecteur et le serveur, puis
  ce qu'il faut chercher :
  - _Tout_ : les titres, artistes et albums contenant le texte, puis un dossier de ce nom ;
  - _Titre_, _Artiste_, _Album_ (un album est lu dans l'ordre des pistes) ;
  - _Dossier_ : un nom de dossier (`Jazz`), ou un chemin depuis la racine du serveur
    (`Musique/Jazz`). Les pistes des sous-dossiers sont comprises. L'action **Parcourir un serveur
    multimédia** de la configuration aide à trouver les chemins.

  Choisissez ensuite de tout lire dans l'ordre, tout en aléatoire, ou le premier résultat
  seulement, et éventuellement un volume. Une recherche qui dure plus de 75 secondes (une très grande bibliothèque sur un serveur qui ne sait pas chercher) s'arrête sur une erreur : précisez-la, par exemple avec un chemin de dossier. L'action renvoie si quelque chose a été trouvé, le nombre
  de pistes en file et le premier titre, pour les actions suivantes.

- **Lire une URL sur un lecteur DLNA** : une radio web, un son ou un fichier d'annonce, par son URL
  http(s), avec un titre et un volume facultatifs. L'URL doit être joignable par le lecteur
  lui-même.

**File d'attente** : un lecteur DLNA ne lit qu'un média à la fois. Pour un album ou un dossier,
l'intégration garde la liste et lui passe les pistes l'une après l'autre (sans blanc si le lecteur
le permet). Suivant et Précédent parcourent la liste. La file s'arrête quand autre chose est lu sur
le lecteur, et elle n'avance que tant que Gladys et l'intégration tournent.

**Annonces** : l'action **Diffuser une notification** du cœur fonctionne sur les lecteurs (elle
demande Gladys Plus pour la synthèse vocale). Elle joue au volume courant (le cœur ne transmet pas
son volume aux intégrations), et le média précédent ne reprend pas ensuite. Pour régler le volume
d'une annonce, placez avant elle une action de contrôle d'appareil sur sa fonctionnalité Volume.

## Tableau de bord

Ajoutez le widget **Lecteur DLNA** et choisissez un lecteur dans ses réglages : il affiche le
titre, l'album, l'état, la position dans la file, la sourdine, une jauge de volume en direct, et
quatre boutons (lecture/pause, stop, volume − et +, par pas de 5 %).

## Actions de configuration

- **Tester une URL de description** : lit une URL de description et dit ce qu'elle contient.
- **Parcourir un serveur multimédia** : liste les dossiers et pistes d'un serveur, depuis la racine
  ou depuis un chemin (`Musique/Albums`).

## Sonos, Samsung, LG

Les enceintes Sonos et les téléviseurs Samsung et LG webOS ont leur propre intégration Gladys, qui
en fait plus que le DLNA (groupes, sources, applications). Cette intégration les voit quand même
s'ils proposent le DLNA : elle sert alors à lire les médias d'un serveur ou des annonces, en
complément de leur intégration.

## Ce qui a été vérifié sur du vrai matériel

- **Vérifié en réel sur un Denon AVR-S650H** (lecture, pause, volume, sourdine, arrêt, parcours du
  serveur intégré) : un flux http se lit, la position avance, pause et reprise fonctionnent, le
  volume réglé dans Gladys est celui de l'ampli (15 dans Gladys = MV15), la sourdine se règle et se
  relit, l'arrêt arrête, et le serveur multimédia intégré se parcourt. L'ampli sort seul de veille
  sur une commande. Sa description, ses descriptions de services et ses réponses d'état sont
  rejouées par les tests.
- **Un lecteur en veille peut mettre une dizaine de secondes à démarrer** : le Denon accepte le
  média et la commande Lecture, se réveille, bascule de source, et perd la commande entre-temps.
  L'intégration suit donc le démarrage jusqu'à 25 secondes : elle renvoie Lecture quand le lecteur
  est réveillé mais arrêté (et recharge le média si besoin), relance une fois une lecture coupée
  juste après son démarrage, et si rien ne se lit l'action de scène « Lire une URL » échoue avec un
  message clair. Les flux https se lisent comme les flux http.
- **Pas encore vérifié sur du vrai matériel** : la file d'attente et ses enchaînements sans blanc,
  la recherche réseau menée par Gladys, et la recherche sur un vrai serveur (MiniDLNA, Plex,
  Jellyfin). Ils sont couverts par des tests sur des appareils simulés, construits d'après des
  formats publics. Signalez tout appareil qui se comporte mal, avec les logs de l'intégration.

## Dépannage

- **Rien dans l'onglet Découverte** : vérifiez que les appareils sont allumés et sur le même réseau
  que Gladys ; lisez les logs de l'intégration (`Discovery: N SSDP answer(s)…`). Sinon, ajoutez une
  URL de description à la main.
- **Une commande échoue avec « 701 »** (transition impossible) : le lecteur refuse cette commande
  dans son état actuel, par exemple Lecture sans rien de chargé.
- **Un fichier ou une radio ne se lit pas** : le lecteur doit accepter son format et joindre son
  URL lui-même. Un lecteur en veille peut mettre une dizaine de secondes à démarrer : l'intégration
  l'attend.
