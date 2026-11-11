# Attivazione Beta Access con Cloudflare — procedura iniziale

**Stato:** progetto pronto per una distribuzione manuale da GitHub Actions. Non ancora distribuito. Per sicurezza, il QR non abilita download finché una release WEmulDroid con attivazione non è stata verificata.

## Configurazione una tantum (non condividere i segreti in chat)

1. Apri https://dash.cloudflare.com/ e seleziona **esclusivamente il nuovo account Free Beta Access**. Non scegliere né modificare l'account Cloudflare AIVEXUS. Verifica che Workers e D1 siano disponibili. 
2. Nel pannello del **nuovo account Beta Access** crea un **nuovo API token dedicato**, limitato a Workers e D1 di questo account. Non riutilizzare token, ID account né chiavi del Cloudflare AIVEXUS. Recupera l'Account ID del nuovo account. Guida ufficiale: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
3. Le credenziali non saranno create automaticamente: salvale soltanto dopo che avrai completato la registrazione e la verifica del nuovo account. Vai al repository https://github.com/pilialvu75-hue/Beta-access → Settings → Secrets and variables → Actions → New repository secret. Salva i seguenti 4 segreti **nuovi e indipendenti**, ciascuno nel campo giusto:
   - BETA_CF_API_TOKEN: token API Cloudflare.
   - BETA_CF_ACCOUNT_ID: identificatore account Cloudflare.
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


## Isolamento account e piano gratuito

Questo progetto deve utilizzare un account Cloudflare **Beta Access** distinto da quello AIVEXUS. Il workflow legge i segreti GitHub `BETA_CF_API_TOKEN` e `BETA_CF_ACCOUNT_ID` (nessuna ricerca o fallback ai token Cloudflare generici), trasmettendoli a Wrangler con i nomi di ambiente standard. Non cambiare la configurazione di AIVEXUS o condividere il suo database.

L'account Free ha quote di utilizzo, non un credito monetario garantito. Non presumere bonus o promozioni; verificare piano, limiti e dettagli di fatturazione dal dashboard del nuovo account prima di abilitare funzionalità a pagamento.

Per la distribuzione iniziale lascia i download **disabilitati**, scegli solo il nuovo account e verifica nome account e Account ID prima del primo deploy.
