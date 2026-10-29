# Stick Calcio 27

Calcio 2D **11 contro 11** con omini stilizzati (stickman), che gira nel browser (Chrome) anche su computer lenti.
Squadre e giocatori sono inventati: è un progetto amatoriale da giocare con gli amici.

- **Contro l'IA**: 4 livelli di difficoltà (Facile, Normale, Difficile, Leggenda).
- **Online 1 contro 1**: uno crea la stanza e riceve un **codice di 5 lettere**, l'altro lo inserisce. Ognuno gioca dal proprio PC.

## Come si gioca

Apri `index.html` con Chrome, oppure (meglio) dalla pagina GitHub Pages del repository.
Il gioco si carica tutto all'inizio; dopo il primo caricamento i file restano in cache.

### Online con un amico
1. Tu: **Crea stanza online** → compare un codice (es. `K7Q2A`). Mandalo al tuo amico.
2. Il tuo amico: **Entra con codice** → scrive il codice → **Entra**.
3. Quando è collegato, tu premi **Avvia la partita**.

Chi crea la stanza fa da "host": il suo computer calcola la partita e l'altro riceve le immagini della partita in tempo reale.
Serve internet su entrambi i PC. Il collegamento è diretto tra i due browser (WebRTC) tramite il server gratuito di PeerJS.
Su alcune reti molto chiuse (scuola, aziende) il collegamento diretto può non riuscire: in quel caso provate da casa o con l'hotspot del telefono.

## Comandi (tastiera)

| Tasto | Con la palla | Senza palla / in difesa |
|---|---|---|
| `W A S D` / frecce | Movimento e mira | Movimento |
| `Shift` | Scatto | Scatto |
| `J` | Passaggio rasoterra (tieni = più forte) | Contrasto in piedi |
| `K` | Tiro (tieni per caricare, rilascia) | Scivolata |
| `L` | Passaggio filtrante | Pressing del compagno (tieni) |
| `I` | Lancio / cross | Uscita del portiere (tieni) |
| `O` | Tiro a giro | |
| `U` | Pallonetto | |
| `E` | Protezione palla (tieni) | Contenimento / jockey (tieni) |
| `F` | Finta (dribbling laterale) | |
| `Spazio` | Allungo (spingi la palla avanti) | |
| `Q` | | Cambia giocatore (con una direzione sceglie da quel lato) |
| `R` | Mentalità: difensiva / equilibrata / offensiva | |
| `Tab` | Radar sì/no | |
| `M` | Audio sì/no | |
| `Esc` / `P` | Pausa | |
| `H` | Schermata comandi | |

Premendo `J`, `K`, `I`... **prima che arrivi la palla** fai un passaggio o un tiro **di prima** (o un colpo di testa se la palla è alta).

## Regole e meccaniche incluse
- Calcio d'inizio, rimesse laterali, calci d'angolo, rinvii dal fondo, punizioni con barriera, rigori.
- Fuorigioco, falli (soprattutto scivolate da dietro), cartellini gialli e rossi con espulsione.
- Portieri che si tuffano, bloccano o respingono; pali e traversa.
- Effetto sui tiri a giro, pallonetti, colpi di testa, stamina che cala con lo scatto.
- Due tempi con recupero, cambio di campo, replay dei gol, statistiche finali.

## Struttura del codice
```
index.html        pagina e menu
css/style.css     grafica dei menu
js/config.js      costanti, maglie, moduli (4-4-2, 4-3-3, 3-5-2)
js/ball.js        fisica della palla
js/player.js      calciatore (movimento, stamina, animazioni)
js/ai.js          intelligenza artificiale e calci piazzati
js/match.js       regole, azioni, controllo dei giocatori umani, snapshot
js/render.js      disegno del campo e degli stickman
js/net.js         online con codice stanza (PeerJS)
js/main.js        menu, ciclo di gioco, modalità
js/lib/peerjs.min.js  libreria PeerJS (licenza MIT, vedi PEERJS-LICENSE)
sw.js             cache per caricamenti successivi più veloci
```

Opzione avanzata: per usare un proprio server PeerJS aggiungi all'indirizzo
`?peerhost=tuoserver.com&peerport=443&peerpath=/`.
