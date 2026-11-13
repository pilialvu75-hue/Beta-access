# WEmulDroid: collaudo privato di un singolo candidato — 14–15 novembre 2026

**Checkpoint 13 novembre:** la [distribuzione manuale #43497986595](https://github.com/pilialvu75-hue/Beta-access/actions/runs/43497986595) del Worker aggiornato alla PR #19 è **PASS**. Non ripetere il Passaggio A per inerzia: verificare prima il rapporto dal Galaxy. Il risultato del probe GitHub Diagnostics non equivale a conferma di pubblicazione; il test reale dei log e il collaudo Windows 11 rimangono aperti. Le prove in CI dell'archiviazione GitHub sono simulate e non pubblicano dati. L'attivazione del pilota privato e qualsiasi inoltro dell'invito richiedono una decisione separata del proprietario.

**Stato:** predisposto nel codice, **non attivo in produzione**. L'invito a un amico non autorizza automaticamente alcuna installazione e non modifica AIVEXUS.

## Obiettivo del weekend

Verificare su un PC Windows 11 di un candidato reale che:
1. l'installer sia quello **gated `v0.9.0-beta.11`**, non la vecchia beta.10;
2. compaia il codice di invito privato al primo avvio;
3. il server accetti **soltanto** un invito non scaduto e non utilizzato da un altro PC;
4. il proprietario riceva la notifica sul Galaxy S24 FE;
5. l'approvazione per **1 giorno** sblocchi automaticamente la finestra Windows, con il breve suono opzionale;
6. WEmulDroid provi ad avviare Android in ambiente reale, senza modificare le impostazioni di sicurezza di Windows;
7. i campioni di errore/CPU/RAM/tempo di avvio, quando il tester consente, arrivino effettivamente a Diagnostics.

## Preparazione obbligatoria dell'amministratore

Prima di coinvolgere il candidato, verificare che GitHub Actions sia PASS sia per il Worker sia per l'installer gated. L'ultima release pubblica beta.10 è **priva** del gate e non deve essere inviata per questo test.

Eseguire il workflow `Deploy Beta Access to Cloudflare (manual)` sulla branch `main`:
- **Passaggio A (deploy del codice e migrazione D1 0005):** `enable_private_pilot=false`, `enable_tester_download=false`, `gated_build_confirmed=false`, `initialize_web_push=false`, `run_live_smoke=false`, `approved_beta_tag` vuoto. Verificare che il pannello Android esistente e l'accesso biometrico siano ancora funzionanti. Le chiavi VAPID devono essere riutilizzate, mai rigenerate.
- Generare un **singolo invito** WEmulDroid con il nome e l'email del destinatario, durata invito fino a fine weekend. Il destinatario **non è verificato automaticamente**. Si può inoltrare il link/QR solo con autorizzazione del proprietario.
- **Passaggio B (attivazione pilota consapevole):** eseguire manualmente lo stesso workflow con `enable_private_pilot=true`, **tutti gli altri booleani falsi** e nessun beta tag. Richiede `DIAGNOSTICS_GITHUB_TOKEN` configurato nell'account separato. Questo apre soltanto le richieste con token privati, **non il download pubblico**.
- Assicurarsi che il candidato sappia recuperare l'installer interno da GitHub Actions, se ha accesso. L'artefatto CI è uno ZIP contenente un **EXE Windows non firmato**, e non è un link pubblico di distribuzione. Non promettere un installer accessibile tramite QR quando questa modalità è attiva.

## Sicurezza Windows 11 e test

- L'installer interno è privo di firma Authenticode e **Smart App Control può bloccarlo**. Il test si ferma se Windows lo blocca. Non chiedere al candidato di disattivare Smart App Control, Defender, il firewall o gli antivirus.
- **Non avviare** una release ungated per provare l'attivazione: potrebbe sembrare funzionare ma non verificare Beta Access.
- Il candidato non deve condividere in chat il token dell'invito, log di accesso personali o le proprie password.
- Il consenso alla diagnostica va richiesto a parte; se negato, il tester può continuare ma le metriche non saranno caricate.
- Nel pannello Android verificare il nome dichiarato vs quello previsto e l'ID installazione prima di approvare.
- A fine prova revocare installazione e invito per interrompere accessi successivi.

## Esito da raccogliere

Nome versione; esito Windows Smart App Control; apertura gate; invito inviato; ricezione push; tempo di sblocco; suono; avvio Android; caricamento Google Play; CPU/RAM/tempo avvio in Diagnostics; eventuali errori. Non raccogliere dati privati del tester.

**Importante:** la modalità pilota privata è un test intenzionale con un candidato, non un rilascio generale; lasciare `PUBLIC_TESTERS_ENABLED=false` e l'accesso alle release pubbliche chiuso. L'identità email non è verificata tramite OTP in questa fase.

**Piano di arresto:** se il deploy non è PASS, la verifica crittografica del gated installer fallisce, Windows lo blocca o il server non distingue gli inviti, non distribuire e non chiedere modifiche alle protezioni del PC.
