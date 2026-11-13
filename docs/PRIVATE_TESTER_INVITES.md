# Inviti privati Beta Access — pilota WEmulDroid

## Obiettivo

Preparare il passaggio a molte applicazioni senza confondere l'applicazione o l'installazione che il proprietario approva. Per ora solo **WEmulDroid Windows** è collegato a un runtime. Non dichiarare che altri prodotti siano supportati finché ciascuno non ha un gate e una telemetria funzionanti.

## Procedura prevista

1. Amministratore Android: accede con passkey e apre **Inviti privati per applicazione**.
2. Inserisce nome ed email **del destinatario previsto**, seleziona WEmulDroid e scadenza dell'invito (1–30 giorni).
3. Il server produce un link HTTPS con token casuale crittografico da 256 bit, memorizzando **solo SHA-256** nel D1. Un link può essere associato a **una sola installazione**.
4. L'amministratore copia il link o usa **Prepara email**: apre il proprio client email, **non invia automaticamente messaggi**.
5. Il tester apre il link, legge il codice e può accedere alla pagina download **solo quando** esiste una release gated esplicitamente abilitata.
6. Dopo l'installazione, al primo avvio WEmulDroid chiede il codice e lo invia su HTTPS assieme al proprio ID installazione e al segreto di dispositivo.
7. Il server verifica app, scadenza, revoca e uso singolo del link. Se accetta, crea **solo una richiesta `pending`**, non un'autorizzazione.
8. Il Galaxy riceve una notifica. L'amministratore vede app, versione, installazione, nome dichiarato e destinatario previsto, controlla e approva la durata. Windows si sblocca automaticamente.
9. Revocare l'invito impedisce ulteriori richieste e, se già usato, revoca anche l'installazione collegata.

## Controlli di sicurezza

- Non attivare `PUBLIC_TESTERS_ENABLED` finché il gated installer effettivo non è stato provato su un PC reale; la precedente beta non ha il gate.
- Nel backend, quando la distribuzione pubblica è abilitata, **nessun enrollment pubblico senza invito valido**. Il solo bypass è la credenziale di amministratore, per test privati.
- Il codice di invito non si salva nel file `installation.json` di WEmulDroid e viene cancellato dalla finestra dopo l'invio riuscito.
- L'email indicata nell'invito **non è verificata**. Il server verifica il possesso del token e il vincolo all'installazione, non la titolarità dell'email. Servirà un provider email per un OTP inviato e verificato lato server prima di poter scrivere `email_verified=true`.
- Il pannello non mostra nuovamente il link segreto dopo la creazione; il database contiene solo il suo hash.
- Nessun contenuto personale o codice segreto deve essere incluso nei log Diagnostics.
- Evitare screenshot o issue contenenti i codici invito. Il download della beta non è automaticamente autorizzato dal solo invito.

## Cosa resta prima del rilascio

- Test remoto della migrazione D1 `0005_private_tester_invites.sql` con backup e versione vigente.
- Collaudo Android del pannello inviti e dell'email precompilata.
- Collaudo Windows sul gated EXE della PR #8, inclusi un invito valido, scaduto e revocato.
- Verifica che l'approvazione e la revoca si riflettano sullo sblocco e nella diagnostica.
- Identità email realmente verificata tramite OTP indipendente, futura fase.
- Catalogo applicazioni estensibile con moduli per altre piattaforme, futura fase.

**Questa PR è da considerare sperimentale finché il collaudo reale non è completato.**