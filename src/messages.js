// -----------------------------------------------------------------------------
// The texts of the errors a user can meet outside the UPnP refusals (those
// live in errors.js): a wrong choice in a scene action, a widget or a
// configuration action, thrown as a UserError in the configured language;
// and the connection status of the integration.
// -----------------------------------------------------------------------------

export const MESSAGES = {
  // Connection status shown on the integration page.
  INIT_FAILED: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Logs der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  PICK_RENDERER: {
    en: 'Pick a DLNA renderer.',
    fr: 'Choisissez un lecteur DLNA.',
    de: 'Wähle ein DLNA-Wiedergabegerät.',
    es: 'Elija un reproductor DLNA.',
  },
  PICK_RENDERER_WIDGET: {
    en: 'Pick a DLNA renderer in the widget settings.',
    fr: 'Choisissez un lecteur DLNA dans les réglages du widget.',
    de: 'Wähle in den Widget-Einstellungen ein DLNA-Wiedergabegerät.',
    es: 'Elija un reproductor DLNA en la configuración del widget.',
  },
  PICK_SERVER: {
    en: 'Pick a DLNA media server.',
    fr: 'Choisissez un serveur multimédia DLNA.',
    de: 'Wähle einen DLNA-Medienserver.',
    es: 'Elija un servidor multimedia DLNA.',
  },
  URL_SCHEME: {
    en: 'The URL must start with http:// or https://.',
    fr: "L'URL doit commencer par http:// ou https://.",
    de: 'Die URL muss mit http:// oder https:// beginnen.',
    es: 'La URL debe empezar por http:// o https://.',
  },
  UNKNOWN_RENDERER: {
    en: 'This renderer is not in Gladys: add it from the Discover tab first.',
    fr: "Ce lecteur n'est pas dans Gladys : ajoutez-le d'abord depuis l'onglet Découverte.",
    de: 'Dieses Wiedergabegerät ist nicht in Gladys: Füge es zuerst im Tab „Entdecken“ hinzu.',
    es: 'Este reproductor no está en Gladys: añádalo primero desde la pestaña Descubrir.',
  },
  NOTHING_PLAYABLE: {
    en: 'Nothing the renderer can play in the results.',
    fr: 'Rien que le lecteur puisse lire dans les résultats.',
    de: 'Nichts in den Ergebnissen, was das Gerät abspielen kann.',
    es: 'Nada en los resultados que el reproductor pueda reproducir.',
  },
  NOTHING_FOUND: {
    en: 'Nothing found on the media server for this favorite.',
    fr: 'Rien trouvé sur le serveur multimédia pour ce favori.',
    de: 'Für diesen Favoriten wurde auf dem Medienserver nichts gefunden.',
    es: 'No se encontró nada en el servidor multimedia para este favorito.',
  },
  SEARCH_TIMEOUT: {
    en: 'The media server took too long to answer: search something narrower (an album, a folder path).',
    fr: 'Le serveur multimédia a mis trop de temps à répondre : cherchez plus précis (un album, un chemin de dossier).',
    de: 'Der Medienserver hat zu lange gebraucht: Suche genauer (ein Album, ein Ordnerpfad).',
    es: 'El servidor multimedia tardó demasiado en responder: busque algo más concreto (un álbum, la ruta de una carpeta).',
  },
  SERVER_NOT_FOUND: {
    en: 'No DLNA media server of this name in Gladys: check the server name of the favorite.',
    fr: 'Aucun serveur multimédia DLNA de ce nom dans Gladys : vérifiez le nom du serveur du favori.',
    de: 'Kein DLNA-Medienserver mit diesem Namen in Gladys: Prüfe den Servernamen des Favoriten.',
    es: 'No hay ningún servidor multimedia DLNA con este nombre en Gladys: compruebe el nombre del servidor del favorito.',
  },
  SEVERAL_SERVERS: {
    en: 'Several DLNA media servers are in Gladys: write the name of the server in the favorite.',
    fr: 'Plusieurs serveurs multimédias DLNA sont dans Gladys : indiquez le nom du serveur dans le favori.',
    de: 'In Gladys gibt es mehrere DLNA-Medienserver: Gib im Favoriten den Namen des Servers an.',
    es: 'Hay varios servidores multimedia DLNA en Gladys: indique el nombre del servidor en el favorito.',
  },
  NO_FAVORITE: {
    en: 'This favorite is not configured: fill it in the configuration of the integration.',
    fr: "Ce favori n'est pas configuré : remplissez-le dans la configuration de l'intégration.",
    de: 'Dieser Favorit ist nicht eingerichtet: Fülle ihn in der Konfiguration der Integration aus.',
    es: 'Este favorito no está configurado: rellénelo en la configuración de la integración.',
  },
  // Gladys 5.3 music player: commands, queue and catalog (src/catalog.js).
  BAD_PLAYBACK_STATE: {
    en: 'Unknown playback state: 0 pauses, 1 plays, 2 stops.',
    fr: 'État de lecture inconnu : 0 met en pause, 1 lance la lecture, 2 arrête.',
    de: 'Unbekannter Wiedergabestatus: 0 pausiert, 1 spielt ab, 2 stoppt.',
    es: 'Estado de reproducción desconocido: 0 pausa, 1 reproduce, 2 detiene.',
  },
  BAD_REPEAT: {
    en: 'Unknown repeat mode: 0 off, 1 all, 2 one track.',
    fr: 'Mode de répétition inconnu : 0 désactivé, 1 tout, 2 un morceau.',
    de: 'Unbekannter Wiederholungsmodus: 0 aus, 1 alle, 2 ein Titel.',
    es: 'Modo de repetición desconocido: 0 desactivado, 1 todo, 2 una pista.',
  },
  CANNOT_SEEK: {
    en: 'This renderer cannot move within a track (no Seek in its UPnP description).',
    fr: 'Ce lecteur ne sait pas se déplacer dans un morceau (pas de Seek dans sa description UPnP).',
    de: 'Dieses Gerät kann nicht innerhalb eines Titels springen (kein Seek in seiner UPnP-Beschreibung).',
    es: 'Este reproductor no puede moverse dentro de una pista (sin Seek en su descripción UPnP).',
  },
  QUEUE_FULL: {
    en: 'The play queue is full (200 tracks): play something else or wait for it to move on.',
    fr: "La file d'attente est pleine (200 morceaux) : lancez autre chose ou attendez qu'elle avance.",
    de: 'Die Warteschlange ist voll (200 Titel): Spiele etwas anderes ab oder warte, bis sie weiterläuft.',
    es: 'La cola de reproducción está llena (200 pistas): reproduzca otra cosa o espere a que avance.',
  },
  QUEUE_INDEX: {
    en: 'This track is no longer in the play queue: open the queue again.',
    fr: "Ce morceau n'est plus dans la file d'attente : rouvrez la file.",
    de: 'Dieser Titel ist nicht mehr in der Warteschlange: Öffne die Warteschlange erneut.',
    es: 'Esta pista ya no está en la cola de reproducción: vuelva a abrir la cola.',
  },
  NO_SERVER: {
    en: 'No DLNA media server in Gladys: add one from the Discover tab of the integration to browse and search it.',
    fr: "Aucun serveur multimédia DLNA dans Gladys : ajoutez-en un depuis l'onglet Découverte de l'intégration pour le parcourir et y chercher.",
    de: 'Kein DLNA-Medienserver in Gladys: Füge einen im Tab „Entdecken“ der Integration hinzu, um ihn zu durchsuchen.',
    es: 'No hay ningún servidor multimedia DLNA en Gladys: añada uno desde la pestaña Descubrir de la integración para explorarlo y buscar en él.',
  },
  SERVER_GONE: {
    en: 'This media server is no longer in Gladys: add it again from the Discover tab.',
    fr: "Ce serveur multimédia n'est plus dans Gladys : ajoutez-le de nouveau depuis l'onglet Découverte.",
    de: 'Dieser Medienserver ist nicht mehr in Gladys: Füge ihn im Tab „Entdecken“ erneut hinzu.',
    es: 'Este servidor multimedia ya no está en Gladys: vuelva a añadirlo desde la pestaña Descubrir.',
  },
  MEDIA_GONE: {
    en: 'This media is no longer on the media server (renamed, moved or deleted): pick it again.',
    fr: "Ce média n'est plus sur le serveur multimédia (renommé, déplacé ou supprimé) : choisissez-le de nouveau.",
    de: 'Dieses Medium ist nicht mehr auf dem Medienserver (umbenannt, verschoben oder gelöscht): Wähle es erneut.',
    es: 'Este medio ya no está en el servidor multimedia (renombrado, movido o eliminado): vuelva a elegirlo.',
  },
  UNKNOWN_MEDIA: {
    en: 'This media does not come from the DLNA integration: pick it in the DLNA catalog.',
    fr: "Ce média ne vient pas de l'intégration DLNA : choisissez-le dans le catalogue DLNA.",
    de: 'Dieses Medium stammt nicht aus der DLNA-Integration: Wähle es im DLNA-Katalog.',
    es: 'Este medio no procede de la integración DLNA: elíjalo en el catálogo DLNA.',
  },
};
