# Linee guida di sviluppo

## Stack applicativo

- L'applicazione web deve essere sviluppata con **Next.js** e TypeScript.
- **PostgreSQL** è il database relazionale per i dati applicativi.
- **MinIO** è lo storage a oggetti per snapshot, replay e altri artefatti binari o voluminosi.
- Le credenziali e gli endpoint dei servizi devono essere configurati tramite variabili d'ambiente e rimanere lato server.

## Lingua del codice

Tutto il codice sorgente deve essere scritto in inglese. Questo include nomi di file e cartelle, variabili, funzioni, tipi, componenti, commenti, messaggi tecnici e nomi di test. La lingua dell'interfaccia utente è una scelta di prodotto separata e può essere localizzata.

## Organizzazione semantica

Organizzare il codice per responsabilità e dominio, usando nomi brevi che descrivano il concetto trattato. Preferire moduli con un nome di dominio e funzioni con nomi semplici all'interno del modulo.

Esempio: in `actions.ts` usare `getList()` quando il modulo rende già chiaro che si tratta delle azioni. Evitare nomi ridondanti come `getActionList()` nello stesso contesto. Applicare lo stesso criterio agli altri domini, per esempio progetti, test ed esecuzioni.

Le funzioni devono avere una responsabilità chiara. Separare lettura, mutazione, validazione e presentazione quando serve a mantenere esplicito il flusso; evitare livelli di astrazione o wrapper che aggiungono solo indirezione.

## Flusso di controllo

- Evitare cicli `for` annidati. Preferire operazioni su collezioni, funzioni dedicate o query che spostino il lavoro nel livello appropriato.
- Evitare condizioni `if` annidate. Usare clausole di uscita anticipate, funzioni di guardia o suddividere i casi in funzioni con responsabilità specifiche.
- Mantenere il flusso principale lineare e leggibile; evitare annidamenti profondi anche quando sono tecnicamente brevi.
- Usare `try/catch` solo ai confini in cui è possibile gestire l'errore, aggiungere contesto utile o convertirlo in un risultato comprensibile per il chiamante. Non usare blocchi generici per nascondere errori o proseguire con uno stato non valido.

## Componenti UI

- Costruire componenti piccoli e atomici, ciascuno con uno scopo visivo e comportamentale chiaro.
- Comporre schermate e flussi da componenti più piccoli invece di concentrare logica, markup e stato in componenti monolitici.
- Tenere separati i componenti di presentazione, l'orchestrazione dello stato e l'accesso ai dati quando questa separazione rende le responsabilità più chiare.
- Riutilizzare i componenti condivisi quando il comportamento e la semantica sono gli stessi; evitare componenti generici con molte modalità condizionali per casi non correlati.
- Preferire elementi HTML semantici e controlli accessibili da tastiera.

## Dati relazionali

PostgreSQL conserva i dati strutturati e relazionati dell'applicazione, inclusi progetti, test, etichette ed esecuzioni. Le entità devono avere identificatori stabili e relazioni esplicite. Le mutazioni che coinvolgono più record coerenti devono usare transazioni.

I dati applicativi non devono incorporare payload grandi di snapshot o registrazioni: questi artefatti vanno conservati in MinIO e referenziati dal database tramite chiavi oggetto e metadati necessari al recupero.

## Snapshot e replay su MinIO

Gli snapshot e i replay devono essere organizzati per esecuzione. Il prefisso degli oggetti è:

```text
replay/{executionId}/
```

Ogni oggetto deve stare sotto il prefisso dell'esecuzione che lo ha prodotto. Il database conserva i riferimenti agli oggetti, i relativi metadati e l'associazione con progetto, test ed esecuzione.

Usare nomi oggetto deterministici quando un artefatto ha un ruolo unico nell'esecuzione; aggiungere un identificatore o un indice quando l'esecuzione produce più artefatti dello stesso tipo. Non usare URL MinIO temporanei come identificatori persistenti: generarli al momento dell'accesso secondo le necessità del servizio.

## Configurazione e gestione degli errori

- Validare la configurazione richiesta all'avvio o al confine d'ingresso, invece di lasciare che valori mancanti generino errori lontano dalla causa.
- Restituire errori tipizzati o risultati espliciti dai confini applicativi; mantenere gli errori originali come causa quando vengono arricchiti.
- Non esporre al client credenziali, stack trace o dettagli interni di PostgreSQL e MinIO.
- Rendere espliciti timeout, limiti e gestione dei fallimenti per le operazioni di rete e storage.

## Convenzioni di modifica

Ogni modifica deve preservare la separazione tra dominio applicativo, persistenza e interfaccia. Prima di aggiungere un nuovo pattern, controllare se nel progetto esiste già una soluzione coerente e riutilizzarla. Mantenere le modifiche circoscritte alla responsabilità interessata e aggiornare la documentazione quando cambia il comportamento o il modello dei dati.
