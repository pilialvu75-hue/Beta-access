# Passaggio sicuro a un nuovo telefono Android

Questa procedura permette di continuare a gestire Beta Access e ricevere notifiche anche cambiando il Galaxy S24 FE. Le richieste tester e le scadenze restano in Cloudflare D1: **non si spostano dal vecchio telefono**.

## Con il vecchio telefono ancora disponibile

1. Sul vecchio telefono, apri Beta Access in Chrome/PWA e accedi con impronta/PIN.
2. Nella sezione **Telefoni amministratori**, tocca **Genera codice per nuovo telefono**. Il codice è monouso, casuale (96 bit), scade dopo 10 minuti ed è memorizzato solo come hash nel database. Non inviarlo in chat pubbliche.
3. Sul nuovo telefono, apri lo stesso URL HTTPS Beta Access in Chrome; espandi **Ho cambiato telefono / Aggiungi nuovo telefono**, inserisci il codice e premi **Registra nuovo telefono con il codice**.
4. Conferma la creazione della nuova passkey con la biometria o il PIN del nuovo telefono. L'app mostra un codice di **richiesta** di 12 caratteri. La registrazione è `pending`, quindi **non apre** la console amministratore.
5. Sul vecchio telefono, premi **Aggiorna telefoni**, verifica che il codice di richiesta corrisponda esattamente e scegli **Approva questo telefono**.
6. Torna sul nuovo telefono; premi **Accedi con impronta / PIN**, **Attiva notifiche push**, poi **Invia notifica di prova**. Assicurati che la notifica Android arrivi anche a schermo bloccato; il servizio push deve essere stato configurato separatamente.
7. Dal nuovo telefono premi **Notifiche solo su questo telefono** per eliminare le vecchie sottoscrizioni push dal server, poi revoca la passkey del telefono precedente nella sezione **Telefoni amministratori**. Puoi farlo soltanto dopo aver confermato che l'accesso con la nuova passkey funziona.

## Se hai già perso il vecchio telefono

Usa il **recupero amministratore** con il segreto `BETA_ADMIN_TOKEN` custodito nell'account GitHub/Cloudflare separato (non copiarlo in chat). Questa opzione esiste nella PWA, ma necessita dell'accesso legittimo al segreto. In alternativa, una passkey sincronizzata dal gestore credenziali può essere disponibile sul nuovo telefono: va verificata. Non si apre indiscriminatamente `PASSKEY_ENROLLMENT_OPEN` e non si inseriscono nuove passkey direttamente come `approved`.

## Sicurezza

- **Nessun trasferimento automatico** di impronte digitali, PIN o chiavi private: restano gestiti dal sistema Android.
- L'invito temporaneo **non concede l'accesso**, perché serve una seconda approvazione da un amministratore autenticato.
- `admin_device_pairings` conserva solo SHA-256 del codice, la scadenza e l'eventuale utilizzo. `admin_passkey_challenges.pairing_hash` vincola la richiesta WebAuthn a quello specifico codice, impedendo di riutilizzarlo per altri dispositivi.
- Non si può revocare l'ultima passkey approvata, riducendo il rischio di perdere completamente l'accesso.
- Il revoca-notifiche richiede una sottoscrizione push già **attiva sul nuovo telefono** e un accesso amministrativo; conserva quella e cancella le altre. Questo non cancella le richieste tester, né il database Diagnostica.
- La UI/endpoint e la migrazione sono sulla [PR #10](https://github.com/pilialvu75-hue/Beta-access/pull/10): **non considerare la funzione disponibile in produzione finché non viene integrata, distribuita e collaudata**.
