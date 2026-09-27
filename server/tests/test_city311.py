"""Ottawa 311 import: which city reports become known hazards (no network, no database)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import city311  # noqa: E402

HEADER = ("Service Request ID | Numéro de demande,Status | État,Type | Type,Description | Description,"
          "Opened Date | Date d'ouverture,Closed Date | Date de fermeture,Address | Adresse,Latitude | Latitude,"
          "Longitude | Longitude,Ward | Quartier,Channel | Voie de service")


def row(rid="1", status="Active", desc="Road Maintenance - Sidewalk/Pathways/Trails Panel Lifted/Sunken | Entretien",
        address="75 Laurier Ave E", lat="45.4231", lon="-75.6831", opened="2026-09-20"):
    return f'{rid},{status},Roads and Transportation,"{desc}",{opened},\\N,{address},{lat},{lon},12,Web'


def parse(*rows):
    return list(city311.parse(["﻿" + HEADER, *rows]))


def test_open_sidewalk_report_is_kept_with_labels():
    [r] = parse(row())
    assert r == {
        "id": "311:1", "type": "uneven_surface", "label_en": "lifted or sunken sidewalk panel",
        "label_fr": "dalle de trottoir soulevée ou affaissée", "address": "75 Laurier Ave E",
        "lat": 45.4231, "lon": -75.6831, "opened": "2026-09-20", "walkway": True,
    }


@pytest.mark.parametrize("skipped", [
    row(status="Resolved"),                                  # the city fixed it
    row(lat="\\N", lon="\\N"),                               # no location
    row(desc="Garbage - SWC | Déchets"),                     # not a walking hazard
    row(desc="Road Maintenance - Sidewalk/Pathways/Trails Debris/Litter | x"),  # passing mess, not mapped
    row(lat="not-a-number"),
])
def test_what_is_left_out(skipped):
    assert parse(skipped) == []


def test_crossing_signals_and_potholes_are_mapped():
    rows = parse(
        row(rid="2", desc="Traffic Operations - Signal Audible | Opérations"),
        row(rid="3", desc="Road Maintenance - Travelled Surface Pothole | Entretien"),
        row(rid="4", desc="Road Maintenance - Curb/Gutter Lip Too High At Driveway | Entretien", address="\\N"),
    )
    assert [(r["id"], r["type"]) for r in rows] == [("311:2", "crossing_signal"), ("311:3", "pothole"), ("311:4", "curb_or_dropoff")]
    assert rows[2]["address"] is None
    assert [r["walkway"] for r in rows] == [True, False, True]  # the road pothole is map-only, never a walk alert


def test_every_road_kind_is_a_real_rule():
    assert city311.ROAD <= set(city311.RULES)


def test_every_rule_has_a_known_type_and_both_languages():
    for desc, (kind, en, fr) in city311.RULES.items():
        assert kind in {"pothole", "uneven_surface", "curb_or_dropoff", "obstacle_in_path", "crossing_signal"}, desc
        assert en and fr and en != fr, desc


def test_a_changed_csv_format_fails_loudly():
    with pytest.raises(ValueError, match="columns changed"):
        list(city311.parse(["Id,Status,Something else", row()]))
