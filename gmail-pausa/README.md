# ⏸ Pausa Mail — ritardo mobile per Gmail

Mentre sei via, ogni mail ti arriva **in ritardo di un tempo fisso** (da 10 min a 6 h).
Con un ritardo di 1 ora, la mail delle 10:30 arriva alle 11:30 e quella delle 11:00 alle 12:00.
Quando premi **🏠 Sono rientrato**, le mail ancora in attesa ti arrivano distribuite nel tempo che scegli
(per esempio 15 minuti), in ordine cronologico. Poi tutto torna normale.

- Le mail restano **non lette** e nessuna viene cancellata.
- **Niente notifiche** sul telefono durante la pausa, perché le mail non passano mai dalla Posta in arrivo.
- Funziona a PC spento: lo script gira sui server Google.

## Come funziona
| Momento | Cosa succede |
|---|---|
| **Avvia pausa** | Viene creato un filtro Gmail che toglie ogni mail in arrivo dalla Posta in arrivo e le mette l'etichetta `⏸ In attesa`. Parte un controllo ogni minuto. |
| **Ogni minuto** | Le mail con *ora di arrivo + ritardo ≤ adesso* tornano nella Posta in arrivo. La precisione è di circa ±1 minuto. |
| **Sono rientrato** | Il filtro viene tolto subito, quindi le mail nuove arrivano normalmente. La coda viene consegnata in modo uniforme nei minuti scelti (dalla più vecchia). |
| **Fine** | Il filtro e il controllo ogni minuto vengono rimossi. Non resta nulla di attivo. |

Puoi cambiare il ritardo anche durante la pausa: sposta lo slider e premi **Aggiorna ritardo**.
Durante la pausa, se ti serve una mail, la trovi sotto l'etichetta `⏸ In attesa`.

## Installazione (una volta sola, circa 10 minuti)
1. Vai su <https://script.google.com> → **Nuovo progetto** e chiamalo `Pausa Mail`.
2. **Impostazioni progetto** (icona ingranaggio) → spunta **"Mostra il file manifest appsscript.json nell'editor"**.
3. Nell'editor copia il contenuto dei tre file di questa cartella:
   - `Code.gs` → sostituisci tutto il contenuto del file `Codice.gs`.
   - `appsscript.json` → sostituisci tutto il contenuto del file esistente.
   - **+ → HTML**, chiamalo esattamente `Index`, e incolla `Index.html`.
4. Salva (💾).
5. **Esegui il deployment → Nuovo deployment** → tipo **App web**:
   - *Esegui come*: **Me**
   - *Chi ha accesso*: **Solo io**
   → **Esegui il deployment**. Google chiede di autorizzare l'accesso a Gmail: accetta.
   Se compare "App non verificata", clicca su **Avanzate → Vai a Pausa Mail**. È normale: l'app è tua e la usi solo tu.
6. Copia l'**URL dell'app web** e:
   - **telefono**: aprilo in Chrome o Safari → *Aggiungi a schermata Home*;
   - **PC**: salvalo nei preferiti.

> Se in futuro modifichi il codice: **Esegui il deployment → Gestisci deployment → ✏️ → Versione: Nuova**, così l'URL resta lo stesso.

## Pulsante dentro Gmail (Tampermonkey, facoltativo)
Il file `gmail-pausa-mail.user.js` aggiunge nella barra in alto di Gmail un pulsante **⏸ Pausa Mail**
con gli stessi comandi della pagina. Il pulsante mostra lo stato: arancione = in pausa, verde = rientro.
1. Inventa una chiave di almeno 20 caratteri e apri una volta
   `<URL app web>?api=init&key=<chiave>`: deve rispondere `{"ok":true,...}`. La prima chiave registrata resta fissa.
2. Nel file sostituisci `INCOLLA-QUI-URL-APP-WEB` e `INCOLLA-QUI-LA-TUA-CHIAVE...`, poi installalo in Tampermonkey.
3. Se Tampermonkey lo chiede, consenti le connessioni a `script.google.com`.

Senza la chiave giusta la web app rifiuta i comandi. Così un altro sito non può avviare la pausa sfruttando il tuo login Google.

## Uso
1. Prima di uscire apri la pagina, scegli il ritardo → **Avvia pausa**.
2. Quando torni, scegli in quanti minuti ricevere la coda → **🏠 Sono rientrato**.
3. **Rilascia tutto adesso** rimette subito in Posta in arrivo tutte le mail in attesa. Usalo in caso di emergenza.

## Dettagli e limiti
- **Conversazioni**: se una mail in attesa è la risposta a una conversazione già nella Posta in arrivo, quella conversazione viene nascosta anch'essa fino alla consegna, così non vedi la risposta in anticipo. Per al massimo un minuto dopo l'arrivo potrebbe ancora comparire.
- Le mail **inviate da te** non vengono mai trattenute.
- Le mail consegnate mantengono **data e ora originali** di arrivo.
- Se dimentichi di premere "Sono rientrato", il ritardo continua: nessuna mail si perde, arriva solo in ritardo.
- Le quote gratuite di Google bastano ampiamente, e il controllo ogni minuto gira solo durante pausa e rientro.
- **Per disinstallare**: premi *Rilascia tutto adesso*, poi elimina il progetto su script.google.com. Se vuoi, elimina anche l'etichetta `⏸ In attesa`.
