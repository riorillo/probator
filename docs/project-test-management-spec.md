# Specifica: gestione progetti e test web

## Scopo

Definire un sistema per raccogliere molti progetti web e organizzare, eseguire e consultare i test associati a ciascun progetto. La gestione deve rendere immediato capire quali progetti esistono, quali test richiedono attenzione e cosa è successo durante ogni esecuzione.

## Direzione visiva

L'interfaccia segue lo stile del prodotto PostHog: uno strumento operativo per sviluppatori, denso di informazioni ma facile da scansionare. L'ispirazione riguarda gerarchia, densità e comportamento dei componenti; non richiede di riprodurre logo, mascotte o identità del marchio PostHog. PostHog descrive la propria UI di prodotto come densa, essenziale e utilitaria ([linee guida per i componenti UI](https://github.com/PostHog/posthog/blob/master/.agents/skills/writing-ui-components/SKILL.md)).

Indicazioni:

- navigazione persistente e compatta, con una gerarchia chiara tra panoramica e progetto attivo;
- contenuto principale ampio, con titoli e azioni di pagina ben distinguibili;
- superfici piatte, bordi e separatori leggeri; usare ombre e contenitori elevati con parsimonia;
- densità informativa da strumento di lavoro: mostrare stati, etichette, URL e ultimo esito vicino all'elemento a cui si riferiscono;
- colori neutri per la struttura, con colori d'accento usati con coerenza per azioni primarie, stati ed evidenziazioni;
- controlli e filtri compatti, ricerca facilmente raggiungibile, menu contestuali per le azioni secondarie;
- tipografia leggibile e funzionale, con dimensioni e pesi distinti per titoli, contenuti, metadati e dati tecnici;
- supporto a tema chiaro e scuro tramite token condivisi per colori, bordi e superfici;
- layout responsive: la board mantiene leggibili le colonne e, su schermi stretti, offre una navigazione utilizzabile tra le colonne.

La panoramica progetti deve favorire ricerca e scansione rapida; la board deve privilegiare lo stato e il contenuto dei test; il dettaglio dell'esecuzione deve rendere evidente l'esito e consentire di ispezionare step e prove senza perdere il contesto.

## Modello concettuale

La struttura principale è:

```text
Progetto
└── Board dei test
    └── Test
        └── Esecuzioni
            └── Risultati e prove
```

- **Progetto**: sito o applicazione web da verificare.
- **Board**: spazio di lavoro dei test di un progetto. In prima versione ogni progetto ha una board.
- **Test**: definizione riutilizzabile di una verifica, composta da passaggi e risultato atteso.
- **Esecuzione**: singolo tentativo di svolgere un test in un dato momento e con una modalità scelta.
- **Prova**: artefatto utile a ricostruire l'esecuzione, come una sessione live, una registrazione rrweb, uno screenshot o un log.

## Progetti

Ogni progetto contiene:

- nome;
- URL della pagina o applicazione;
- descrizione;
- immagine di anteprima, preferibilmente ricavata dalla pagina indicata.

La panoramica dei progetti mostra queste informazioni in una griglia o in un elenco. Deve essere possibile trovare rapidamente un progetto tramite ricerca; filtri e ordinamento potranno aiutare quando il numero di progetti cresce.

Aprendo un progetto si accede alla sua board e ai dettagli del progetto.

## Board e test

La board usa colonne per rappresentare lo stato del lavoro sul test. Le colonne iniziali suggerite sono **Da fare**, **In corso** e **Completato**. Un test può essere spostato tra le colonne.

Le **etichette** raggruppano i test per tema, area o tipo, ad esempio `checkout`, `accessibilità` o `regressione`. Le etichette non rappresentano l'esito di un'esecuzione.

Ogni test contiene almeno:

- titolo;
- descrizione o obiettivo;
- lista ordinata di step;
- risultato atteso per i singoli step, quando applicabile;
- controlli attesi sullo stato finale della pagina;
- una o più etichette.

Un test è una definizione riutilizzabile. Eseguirlo non ne modifica la definizione e non sovrascrive i risultati dei tentativi precedenti.

## Esecuzioni

Ogni avvio crea una nuova esecuzione collegata al test. L'utente sceglie una modalità:

- **Live**: esecuzione osservabile in tempo reale usando il motore browser workspace `packages/browser-engine/`.
- **Registrazione**: esecuzione accompagnata da una registrazione rrweb, consultabile successivamente.

La modalità è una proprietà dell'esecuzione, non del test: lo stesso test può essere avviato con modalità diverse in tentativi distinti. In una fase successiva si potrà valutare l'esecuzione combinata Live + Registrazione.

Ogni esecuzione conserva almeno:

- test di origine;
- modalità;
- data e ora di inizio e fine;
- stato: **In corso**, **Superata**, **Fallita** o **Bloccata**;
- ambiente e URL effettivo, se disponibili;
- risultato per ciascuno step;
- esito dei controlli finali;
- spiegazione dell'errore e prove associate.

La board mostra lo stato di lavoro del test. L'esito dell'ultima esecuzione è mostrato separatamente, per esempio come badge sulla card. La card mantiene accessibile la cronologia di tutte le esecuzioni.

## Valutazione del test

Al termine, il sistema confronta ciò che è stato osservato con gli step e i risultati attesi definiti nel test. Valuta inoltre lo stato finale della pagina, usando i controlli configurati nel test.

Per ogni step, il risultato dovrebbe indicare:

- esito: superato, fallito o non verificabile;
- comportamento atteso;
- comportamento osservato;
- eventuale dettaglio dell'errore;
- riferimenti alle prove pertinenti, quando disponibili.

L'esito complessivo è **Superata** solo se gli step obbligatori e i controlli finali sono superati. È **Fallita** quando una verifica obbligatoria non è soddisfatta. È **Bloccata** quando l'esecuzione non può completare o valutare correttamente il test, ad esempio per un errore di avvio o una condizione esterna.

La spiegazione deve distinguere i fatti osservati dalle possibili cause. Per esempio, è corretto riportare che “il pulsante atteso non è comparso entro il timeout”; attribuire il problema a una risposta lenta del server richiede evidenze, come i log di rete. Quando la causa non è dimostrabile, va presentata come ipotesi.

## Risultati e prove

La pagina di dettaglio di un'esecuzione presenta l'esito complessivo, i risultati step per step e i controlli finali. Da lì si possono aprire le prove disponibili:

- vista live durante un'esecuzione Live;
- replay rrweb per un'esecuzione registrata;
- screenshot o log collegati a uno step o al risultato finale.

Le prove restano collegate alla specifica esecuzione e non al solo test, così i tentativi sono consultabili e confrontabili nel tempo.

## Requisiti di privacy per le registrazioni

Decisione per l'implementazione locale single-operator: snapshot Live e registrazioni rrweb sono acquisiti senza mascheramento, così il replay mostra il flusso completo della pagina. Questo include testo, valori dei campi, URL e, dove supportato, canvas e iframe; tali prove possono contenere dati sensibili e vanno usate solo con pagine fidate. Gli artefatti restano associati a progetto ed esecuzione, dietro accesso locale e retention configurabile. Prima di esporre il prodotto a più utenti o di distribuirlo come servizio condiviso, reintrodurre regole di consenso, mascheramento/esclusione selettiva e autorizzazione per progetto.

## Ambito iniziale

La prima versione comprende:

1. panoramica dei progetti con nome, URL, descrizione e anteprima;
2. una board per progetto;
3. card test spostabili tra stati di lavoro;
4. etichette per classificare i test;
5. test con lista ordinata di step e aspettative finali;
6. esecuzioni in modalità Live oppure Registrazione rrweb;
7. valutazione per step e dello stato finale della pagina;
8. cronologia delle esecuzioni con risultati e prove.

La combinazione delle due modalità, le board multiple per progetto e ulteriori opzioni di organizzazione restano possibili estensioni, non requisiti iniziali.

## Criteri di accettazione

- Un utente può trovare un progetto dalla panoramica e aprirne la board.
- Può creare un test con step, aspettative e etichette, e spostarlo tra gli stati di lavoro.
- Può avviare il test in modalità Live o Registrazione.
- Al termine, può vedere l'esito complessivo, il risultato di ogni step e quello dei controlli finali.
- In caso di errore, il risultato indica cosa atteso e cosa osservato senza presentare una causa ipotetica come fatto.
- Ogni nuova esecuzione crea una voce distinta nella cronologia e conserva le proprie prove.
- L'esito dell'esecuzione rimane distinto dallo stato della card sulla board.
