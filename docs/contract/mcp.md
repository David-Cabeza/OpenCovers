# MCP tool catalog

The MCP server is planned, not yet implemented. This catalog is the target contract. The HTTP API implements these operations today.

| Tool id | HTTP operation | Kind | Idempotency |
| --- | --- | --- | --- |
| `reservation.availability` | GET /venues/{venueId}/availability | read | none |
| `reservation.agenda` | GET /venues/{venueId}/agenda | read | none |
| `reservation.list` | GET /venues/{venueId}/reservations | read | none |
| `reservation.search` | GET /venues/{venueId}/reservations/search | read | none |
| `reservation.get` | GET /venues/{venueId}/reservations/{id} | read | none |
| `reservation.create` | POST /venues/{venueId}/reservations | write | required |
| `reservation.modify` | POST /venues/{venueId}/reservations/{id}/modify | write | required |
| `reservation.cancel` | POST /venues/{venueId}/reservations/{id}/cancel | write | required |
| `reservation.status` | POST /venues/{venueId}/reservations/{id}/status | write | required |
| `reservation.events` | GET /venues/{venueId}/events | read | none |
| `reservation.erasure` | POST /venues/{venueId}/erasure | write | required |
| `venue.getConfig` | GET /venues/{venueId}/config | read | none |
| `venue.setConfig` | PUT /venues/{venueId}/config | write | required |

Reservation writes carry an idempotency key and return the reservation. Erasure returns the counts. Reads never mutate.

The MCP server is scoped per agent key. A key sees only the venues it is granted, and the grant limits which tool ids it may call.
