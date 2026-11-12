# Cambiare il telefono amministratore di AIVEXUS Beta Access

**Stato:** implementazione in PR sperimentale; non considerare la migrazione attiva in produzione fino a CI, deployment controllato e collaudo su due telefoni.

## Cosa resta e cosa cambia
Le richieste dei tester, le date di scadenza e l'archivio D1 **rimangono sul servizio Cloudflare**. Le impronte e i PIN non sono trasferibili: ogni telefono usa una passkey gestita da Android/WebAuthn. Le notifiche Web Push usano una sottoscrizione distinta per dispositivo; dopo il cambio telefono va abilitata nuovamente sul nuovo Android.

## Procedura con vecchio telefono disponibile
1. Sul vecchio Galaxy accedi a `/admin/` con impronta/PIN.
2. Apri **Telefoni amministratore → Prepara un nuovo telefono**. L'app genera un codice di 32 caratteri, casuale, valido **15 minuti**. Solo il suo hash SHA-256 viene conservato in D1. Non pubblicarlo in issue, chat o screenshot.
3. Sul nuovo Android apri la stessa URL HTTPS in Chrome. Nel campo **Codice nuovo telefono** incolla il codice, poi premi **Registra questo telefono**. Conferma la passkey con il metodo biometrico/PIN disponibile.
4. Il nuovo telefono visualizza un codice di conferma distinto di **12 caratteri**. La nuova credenziale resta **pending** (nessun accesso).
5. Dal vecchio telefono premi **Aggiorna telefoni**, confronta esattamente il codice di conferma con quello visibile sul nuovo dispositivo, premi **Approva nuovo telefono** e ridigita il codice richiesto.
6. Sul nuovo telefono premi **Accedi con impronta/PIN**. Poi **Attiva notifiche push** e **Invia notifica di prova**. Non procedere se la notifica non arriva.
7. Quando la nuova notifica funziona, puoi revocare la vecchia passkey nella sezione **Telefoni amministratore**. Il server impedisce di revocare l'ultima passkey approvata.
8. Sul nuovo Android premi **Notifiche solo su questo telefono** per rimuovere dal server le vecchie sottoscrizioni push. Conferma esplicitamente la decisione. Quest'ultima operazione non revoca la passkey: sono due controlli separati.

## Sicurezza
- Il codice di trasferimento è un segreto temporaneo di **128 bit**; viene utilizzato una volta sola e scade dopo 15 minuti.
- La sfida WebAuthn viene vincolata all'hash del codice; un browser sconosciuto non ottiene accesso amministratore soltanto conoscendo il codice.
- Solo una sessione *già autenticata con passkey approvata* può emettere un codice, visualizzare le passkey e approvare/revocare nuovi dispositivi.
- Il codice di conferma a 12 caratteri è soltanto un riferimento da confrontare: **non** equivale ad un'autorizzazione.
- Il primo bootstrap manuale Cloudflare resta chiuso (`PASSKEY_ENROLLMENT_OPEN=false`).
- Prima dell'attivazione in produzione servono un controllo di sicurezza e un test end-to-end su due telefoni reali.

## Se perdi il vecchio telefono
Se la passkey è sincronizzata dal provider Android sul nuovo dispositivo, verifica prima se riesci ad accedere con la passkey esistente. **Non è garantito** che una passkey sia stata sincronizzata.

Se hai perso tutte le passkey approvate, il trasferimento ordinario non può partire: è progettato per non aggirare la sicurezza. Serve una procedura di recupero **direttamente dall'account Cloudflare Beta Access**, con verifica dell'identità del proprietario, disabilitazione delle vecchie credenziali e inizializzazione controllata di una nuova passkey. Non condividere mai token, password o chiavi di recupero in chat.
