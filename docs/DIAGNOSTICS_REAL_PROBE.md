# Prova Diagnostics reale, prima del tester esterno — solo su consenso

**Stato:** il workflow è installabile tramite PR; non viene eseguito automaticamente. L'esecuzione può pubblicare **un** evento interamente sintetico in una **release pubblica** del repository Diagnostics. Avviarlo solo dopo consenso esplicito del proprietario alla pubblicazione di questa evidenza.

## Cosa dimostra

Il test collega **l'API HTTPS reale Beta Access**, D1, il job pianificato del Worker (ogni cinque minuti) e GitHub:
1. Verifica dal server che PUBLIC_TESTERS_ENABLED=false, PRIVATE_PILOT_ENROLLMENT_ENABLED=false e la configurazione infrastrutturale sia pronta.
2. Crea una installazione fittizia con identificativo casuale e segreto temporaneo (solo in RAM del runner). Usa la versione 0.0.0-smoke per non inviare notifiche Push Android.
3. Con la credenziale amministratore esistente crea una richiesta pending, la approva per un giorno e indica un **consenso alla telemetria simulato** per questo solo dispositivo di test.
4. Invia un unico APP_START con startup_ms=123 (nessun dato del tester).
5. Attende il relay Worker → D1 → GitHub e verifica che l'asset JSONL sia leggibile e contenga esattamente lo schema previsto, la sessione sintetica e la sola metrica consentita.
6. Revoca l'installazione fittizia anche in caso di errore dopo la creazione. La release sintetica su GitHub **rimane pubblica come prova tecnica**.

Il test **non installa software**, non attiva gli inviti, non distribuisce EXE e non cambia l'account Cloudflare o il Worker già distribuito. Non è una prova del percorso reale **WEmulDroid Windows → Diagnostics**, che richiede un collaudo separato con consenso del tester.

## Esecuzione manuale (solo se autorizzata)

- GitHub repository pilialvu75-hue/Beta-access → **Actions** → **Verify real Diagnostics relay (manual synthetic event)**.
- **Run workflow**, ramo **main**.
- Spuntare 'I authorize ONE synthetic, non-personal event to appear in the public Diagnostics GitHub repo' solo dopo aver deciso di rendere visibile l'evento tecnico di collaudo.
- Avviare. Il workflow **fallisce intenzionalmente** se la spunta è assente o se il ramo non è main.
- Controllare il report PROBE PASS e il link pubblico della release sintetica. Dopo il PASS, il test end-to-end del relay può essere marcato PASS, **ma non quello fisico Windows**.

I segreti GitHub preesistenti BETA_ADMIN_TOKEN e DIAGNOSTICS_GITHUB_TOKEN sono letti soltanto nel workflow manuale. Non vengono mostrati in console né passati al client Windows. L'installazione fittizia non compare nelle notifiche Android grazie alla versione 0.0.0-smoke.

## Quando fallisce

- Se un gate pubblico o privato è acceso, il test si interrompe prima dell'enrollment.
- Se GitHub non permette di creare release o caricare asset, l'evento rimane in D1 per futuri tentativi automatici del cron; non dichiarare PASS.
- Se GitHub impiega troppo a ricevere/servire il file, il test scade dopo circa nove minuti di controlli, poi revoca l'installazione. L'evento può ancora essere pubblicato in seguito da un retry.
- Se la revoca non riesce, il workflow segnala errore: controllare l'inbox amministratore e revocare la riga AUTOTEST DIAGNOSTICS manualmente.
- Non rilanciare ripetutamente in caso di errore: prima esaminare l'output per evitare molte release sintetiche. Mai usare dati personali o log di un vero tester per recuperare questo test.

**Gate rimasti per il candidato 14–15 novembre:** installer protetto approvato, decisione di distribuzione privata esplicita, Windows Smart App Control senza disabilitare protezioni, invito monouso, push e approvazione sul Galaxy, avvio Android, consenso Diagnostics e prova telemetria reale.
