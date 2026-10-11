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
    de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Logs der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  PICK_RENDERER: {
    en: 'Pick a DLNA renderer.',
    fr: 'Choisissez un lecteur DLNA.',
    de: 'Wählen Sie ein DLNA-Wiedergabegerät.',
    es: 'Elija un reproductor DLNA.',
  },
  PICK_RENDERER_WIDGET: {
    en: 'Pick a DLNA renderer in the widget settings.',
    fr: 'Choisissez un lecteur DLNA dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen ein DLNA-Wiedergabegerät.',
    es: 'Elija un reproductor DLNA en la configuración del widget.',
  },
  PICK_SERVER: {
    en: 'Pick a DLNA media server.',
    fr: 'Choisissez un serveur multimédia DLNA.',
    de: 'Wählen Sie einen DLNA-Medienserver.',
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
    de: 'Dieses Wiedergabegerät ist nicht in Gladys: Fügen Sie es zuerst im Tab „Entdecken“ hinzu.',
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
    de: 'Der Medienserver hat zu lange gebraucht: Suchen Sie genauer (ein Album, ein Ordnerpfad).',
    es: 'El servidor multimedia tardó demasiado en responder: busque algo más concreto (un álbum, la ruta de una carpeta).',
  },
  SERVER_NOT_FOUND: {
    en: 'No DLNA media server of this name in Gladys: check the server name of the favorite.',
    fr: 'Aucun serveur multimédia DLNA de ce nom dans Gladys : vérifiez le nom du serveur du favori.',
    de: 'Kein DLNA-Medienserver mit diesem Namen in Gladys: Prüfen Sie den Servernamen des Favoriten.',
    es: 'No hay ningún servidor multimedia DLNA con este nombre en Gladys: compruebe el nombre del servidor del favorito.',
  },
  SEVERAL_SERVERS: {
    en: 'Several DLNA media servers are in Gladys: write the name of the server in the favorite.',
    fr: 'Plusieurs serveurs multimédias DLNA sont dans Gladys : indiquez le nom du serveur dans le favori.',
    de: 'In Gladys gibt es mehrere DLNA-Medienserver: Geben Sie im Favoriten den Namen des Servers an.',
    es: 'Hay varios servidores multimedia DLNA en Gladys: indique el nombre del servidor en el favorito.',
  },
  NO_FAVORITE: {
    en: 'This favorite is not configured: fill it in the configuration of the integration.',
    fr: "Ce favori n'est pas configuré : remplissez-le dans la configuration de l'intégration.",
    de: 'Dieser Favorit ist nicht eingerichtet: Füllen Sie ihn in der Konfiguration der Integration aus.',
    es: 'Este favorito no está configurado: rellénelo en la configuración de la integración.',
  },
};
