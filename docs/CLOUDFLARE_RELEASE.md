# Attivazione Beta Access con Cloudflare — procedura iniziale

**Stato:** progetto pronto per una distribuzione manuale da GitHub Actions. Non ancora distribuito. Per sicurezza, il QR non abilita download finché una release WEmulDroid con attivazione non è stata verificata.

## Configurazione una tantum (non condividere i segreti in chat)

1. Apri https://dash.cloudflare.com/ con l'account Cloudflare scelto. Verifica che Workers e D1 siano disponibili. 
2. Nel pannello Cloudflare crea un **API token limitato** alla gestione dei Workers e dei database D1. Prendi l'Account ID del medesimo account. Guida ufficiale: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
3. Vai al repository https://github.com/pilialvu75-hue/Beta-access → Settings → Secrets and variables → Actions → New repository secret. Salva i seguenti 4 segreti, ciascuno nel campo giusto:
   - CLOUDFLARE_API_TOKEN: token API Cloudflare.
   - CLOUDFLARE_ACCOUNT_ID: identificatore account Cloudflare.
   - BETA_ADMIN_TOKEN: nuova passphrase casuale molto robusta, **almeno 48 caratteri**, dedicata a Beta Access; verrà usata come chiave amministratore sull'S24.
   - DIAGNOSTICS_GITHUB_TOKEN: token GitHub fine-grained con Contents read/write limitato esclusivamente a pilialvu75-hue/Ai-orchestrator-diagnostics.
4. In GitHub → Actions → **Deploy Beta Access to Cloudflare (manual)** → Run workflow, per il PRIMO avvio imposta:
   - Enable tester download: **false**
   - Approved beta tag: vuoto
   - Gated build confirmed: **false**
5. L'esecuzione verificherà il codice, creerà (o riutilizzerà) D1 nell'Unione europea, applicherà lo schema, distribuirà il Worker e installerà i segreti lato server.
6. Trova nella dashboard Cloudflare il Worker **aivexus-beta-access** e il suo indirizzo HTTPS .workers.dev. Apri:
   - /api/catalog : deve indicare available=false
   - /admin/ : deve mostrare il pannello sul Galaxy S24 FE
   - /api/admin/requests : senza chiave deve restituire 401.
7. Su Galaxy S24 FE, apri /admin/ con Chrome, menu ⋮ → Installa app / Aggiungi a schermata Home. Inserisci la chiave amministratore **soltanto** in questa app sul tuo telefono.
8. Non abilitare la condivisione esterna finché non avremo pubblicato una nuova beta WEmulDroid con gate e verificato il ciclo completo di autorizzazione e diagnostica. L'attuale beta Windows non acquisisce l'attivazione con il solo QR.

## Dopo il primo collaudo

Un nuovo run manuale permette di abilitare il download specificando il tag ESATTO della release gated e dichiarando di aver verificato il gate su un PC reale, le richieste Android e la ricezione Diagnostics. Una release non pubblicata o senza gli asset richiesti non sarà proposta come valida.

La PWA ancora **non** invia notifiche push a telefono chiuso né email automaticamente; prepara l'email da inviare con l'app di posta. Le protezioni Smart App Control e le verifiche della firma installer Windows restano applicabili.

Non aggiungere segreti nei file sorgente, nell'issue, nelle schermate inviate o nella chat.
