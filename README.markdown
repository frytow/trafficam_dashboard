# Tableau de Bord de surveillance du Trafic - README

Ce tableau de bord web affiche des données de trafic en temps réel (densité, vitesse, alertes) sur une carte interactive, avec flux de caméras, notifications et statistiques. Voici un aperçu des fichiers principaux :

## Aperçu des Fichiers

### 1. dashboard.html

- **Rôle** : Interface HTML principale.
- **Fonction** : Affiche une carte Leaflet, données en temps réel (densité, vitesse), flux vidéo et graphiques.

### 2. tables.html

- **Rôle** : Page HTML pour la vue tabulaire.
- **Fonction** : Liste les intersections, permet filtrage par gouvernorat, édition et suppression.

### 3. notifications.html

- **Rôle** : Page HTML pour les notifications.
- **Fonction** : Affiche les notifications filtrées par gouvernorat ou nœud (contenu, heure, adresse).

### 4. statistiques.html

- **Rôle** : Page HTML pour les statistiques.
- **Fonction** : Montre graphiques de congestion (heures, zones) et carte des zones congestionnées.

### 5. map_v3.js

- **Rôle** : Script JS pour la carte et données en temps réel.
- **Fonction** : Gère carte Leaflet, WebSocket/polling, flux vidéo et graphiques Chart.js.

### 6. tables_script.js

- **Rôle** : Script JS pour la table des intersections.
- **Fonction** : Charge intersections, gère filtres, édition (via URL caméra) et suppression.

### 7. notifications.js

- **Rôle** : Script JS pour les notifications.
- **Fonction** : Récupère et affiche notifications avec filtrage par gouvernorat/nœud.

### 8. statistics.js

- **Rôle** : Script JS pour les statistiques.
- **Fonction** : Met à jour graphiques (Chart.js) et carte des zones congestionnées (Leaflet).

### 9. serverAppV2.py

- **Rôle** : Serveur Flask pour requêtes HTTP.
- **Fonction** : Fournit API pour intersections, nœuds, caméras, notifications ; gère filtrage, suppression, mises à jour.

### 10. app_v3.py

- **Rôle** : Serveur WebSocket pour données en temps réel.
- **Fonction** : Traite données véhicules, notifications, configurations ; met à jour base MySQL.

### 11. start_dashboard.py

- **Rôle** : Script Python pour lancer le tableau.
- **Fonction** : Met à jour adresses IP, lance serveurs Flask/WebSocket, ouvre tableau dans navigateur.

### 12. traffic_control_db.sql

- **Rôle** : Script SQL pour la base de données.
- **Fonction** : Crée la base `traffic_control_db` avec tables `cams`, `history`, `intersections`, `nodes`, `notifications`

## Fonctionnement

- **Frontend** : Fichiers HTML/JS affichent carte, données en temps réel, notifications, statistiques via WebSocket/polling.
- **Backend** : `serverAppV2.py` gère requêtes HTTP ; `app_v3.py` diffuse données en temps réel, connectés à MySQL `traffic_control_db`.

## Prérequis

- **Frontend** : Leaflet.js, Chart.js, Bootstrap.
- **Backend** : Python 3.x (`flask`, `flask-cors`, `mysql-connector-python`, `websockets`, `aiomysql`), MySQL (`traffic_control_db`).
- **Serveur** : (Flask : port 5000, WebSocket : port 8765).

## Installation

1. Configurez MySQL, exécutez `traffic_control_db.sql` pour créer la base et tables.
2. Installez dépendances Python : `pip install flask flask-cors mysql-connector-python websockets aiomysql`.
3. Lancez : `python start_dashboard.py` pour démarrer serveurs et ouvrir tableau de bord.