# Identificazione delle richieste di autorizzazione — roadmap multi-app

## Cosa offre oggi (pilota WEmulDroid)

Ogni richiesta contiene `app_id` (oggi solo `wemuldroid`), piattaforma (`windows`), versione, ID univoco dell'installazione e nome inserito liberamente dal tester (`label`).

- Il pannello mostra chiaramente **applicazione**, **versione**, **nome dichiarato**, **installazione** e **stato**.
- Le richieste **in attesa** sono evidenziate e vengono ordinate prima di quelle già decise.
- I filtri per app, stato e ricerca si applicano alle **ultime 200 richieste restituite dall'API**. Non sono ancora una ricerca globale con paginazione.
- Il nome del tester **NON è un'identità verificata**. Non è corretto affermare che una richiesta provenga davvero da una persona nota solo perché ha inserito il suo nome.
- Gli AUTOTEST CI non devono essere approvati; l'interfaccia disabilita le azioni su tali righe. Questo non sostituisce le verifiche backend del dispositivo.

## Come evolvere per molte applicazioni

Una futura richiesta di attivazione dovrebbe essere associata a:

| Campo | Origine affidabile e verifica |
|---|---|
| Applicazione | Catalogo server `applications`, con app ID immutabile, nome, piattaforma, publisher, canale |
| Versione | Release controllata: tag, checksum SHA256 e firma del publisher ove disponibile |
| Tester | Invito nominativo con token casuale monouso, associato a una email verificata con codice temporaneo o un'identità federata. L'email dichiarata non basta |
| Dispositivo / installazione | UUID per installazione e credenziale segreta verificata lato server; non un nome PC non verificabile |
| Autorizzazione | Stato, data, durata, amministratore che ha deciso, eventuale revoca |
| Diagnostica | Consenso separato, codici errore e metriche numeriche minimizzate, filtri per versione/app |

**Fasi consigliate:** 
1. Registro delle applicazioni con ID server, icona, piattaforma, channel e release approvata.
2. Inviti specifici per app/tester (link e QR monouso, eventuale scadenza).
3. Verifica di possesso della email e collegamento tra invito e installazione.
4. Paginazione, ricerca globale, filtri e raggruppamento nel pannello Android.
5. Cronologia decisioni e audit; gestione multi-app dei report Diagnostics.

## Sicurezza / privacy

Non raccogliere automaticamente email di Windows, nomi account locali, impronte macchina, screenshot, contenuti personali o file di log per "dimostrare" l'identità. La verifica deve avvenire con un invito esplicito e consenso informato. Un'app client non firmata può essere imitata; un ID di app inviato dal client non è una prova crittografica dell'origine. Prevedere distribuzione di installer ufficiali con hash e firma quando disponibile.

Il progetto Beta Access rimane su Cloudflare e GitHub dedicati, separati dal runtime AIVEXUS.
