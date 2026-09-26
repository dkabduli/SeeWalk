"""Pre-generated phrase library (spec §8). Keys are what the web client plays."""

PHRASES: dict[str, dict[str, str]] = {
    # fast layer (COCO-SSD)
    "person_ahead": {"en": "Person ahead", "fr": "Personne devant"},
    "person_left": {"en": "Person on your left", "fr": "Personne à gauche"},
    "person_right": {"en": "Person on your right", "fr": "Personne à droite"},
    "bike_left": {"en": "Bike on your left", "fr": "Vélo à gauche"},
    "bike_ahead": {"en": "Bike ahead", "fr": "Vélo devant"},
    "bike_right": {"en": "Bike on your right", "fr": "Vélo à droite"},
    "car_left": {"en": "Car on your left", "fr": "Voiture à gauche"},
    "car_ahead": {"en": "Car ahead", "fr": "Voiture devant"},
    "car_right": {"en": "Car on your right", "fr": "Voiture à droite"},
    # slow layer (Gemini)
    "stop_sign": {"en": "Stop sign ahead", "fr": "Panneau d'arrêt devant"},
    "crosswalk": {"en": "Crosswalk ahead", "fr": "Passage pour piétons devant"},
    "head_height": {"en": "Obstacle at head height", "fr": "Obstacle à hauteur de tête"},
    "obstacle_path": {"en": "Obstacle in your path", "fr": "Obstacle sur votre chemin"},
    "pothole": {"en": "Pothole ahead", "fr": "Nid-de-poule devant"},
    "uneven": {"en": "Uneven ground ahead", "fr": "Sol inégal devant"},
    "stairs_down": {"en": "Stairs going down", "fr": "Escalier qui descend"},
    "curb": {"en": "Curb ahead", "fr": "Bordure devant"},
    "construction": {"en": "Construction ahead", "fr": "Travaux devant"},
    "traffic_light": {"en": "Traffic light ahead", "fr": "Feu de circulation devant"},
    # system
    "unclear": {"en": "Unclear", "fr": "Incertain"},
    "nothing_detected": {"en": "Nothing detected", "fr": "Rien de détecté"},
    # voice commands
    "intro": {
        "en": "Vision Companion is on. I'll warn you about potholes, curbs and signs in your path. To ask me something, say Vision Companion, "
              "then: what's ahead, what am I holding, what's blocking my path, or read this.",
        "fr": "Vision Companion est prêt. Je vous préviens des nids-de-poule, bordures et panneaux sur votre chemin. Pour me poser une question, "
              "dites Vision Companion, puis : qu'y a-t-il devant, qu'est-ce que je tiens, qu'est-ce qui bloque mon chemin, ou lis ceci.",
    },
    "cross_refusal": {
        "en": "I can't tell you when it's safe to cross. Listen for traffic and use your cane.",
        "fr": "Je ne peux pas vous dire quand traverser. Écoutez la circulation et utilisez votre canne.",
    },
    "not_sure": {"en": "Sorry, I can't tell.", "fr": "Désolé, je ne peux pas le dire."},
    "no_connection": {"en": "No connection, I can't see right now", "fr": "Pas de connexion, je ne vois rien pour l'instant"},
    "connection_back": {"en": "Connection back", "fr": "Connexion rétablie"},
    "camera_blocked": {"en": "Camera blocked", "fr": "Caméra bloquée"},
    "walk_started": {"en": "Walk mode on", "fr": "Mode marche activé"},
    "walk_stopped": {"en": "Walk mode off", "fr": "Mode marche désactivé"},
}


# Street alerts, one clip per direction, so they play instantly (no live voice): "st_<type>_<direction>"
STREET = {
    "pothole": ("Pothole", "Nid-de-poule"),
    "uneven_surface": ("Uneven ground", "Sol inégal"),
    "curb_or_dropoff": ("Curb", "Bordure"),
    "stairs_down": ("Stairs going down", "Escalier qui descend"),
    "steps_up": ("Steps up", "Marches qui montent"),
    "construction": ("Construction", "Travaux"),
    "head_height_obstacle": ("Obstacle at head height", "Obstacle à hauteur de tête"),
    "stop_sign": ("Stop sign", "Panneau d'arrêt"),
    "crosswalk": ("Crosswalk", "Passage pour piétons"),
    "traffic_light": ("Traffic light", "Feu de circulation"),
    "door": ("Door", "Porte"),
    "door_open": ("Open door", "Porte ouverte"),
    "door_opening": ("Door opening", "Porte qui s'ouvre"),
    "elevator": ("Elevator", "Ascenseur"),
    "pillar": ("Pillar", "Pilier"),
}
WHERE = {
    "ahead": ("ahead", "devant"),
    "left": ("on your left", "à gauche"),
    "right": ("on your right", "à droite"),
}
for _type, (_en, _fr) in STREET.items():
    for _dir, (_en_where, _fr_where) in WHERE.items():
        PHRASES[f"st_{_type}_{_dir}"] = {"en": f"{_en} {_en_where}", "fr": f"{_fr} {_fr_where}"}
