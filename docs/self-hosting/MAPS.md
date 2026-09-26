# Maps and location search

The current web map and location autocomplete use Mapbox. They require a public
browser token even when the rest of the application starts successfully without
provider credentials. A blank map with `An API access token is required to use
Mapbox GL` in the browser console means that no token reached the map component.
The usable fallback for an unconfigured map/geocoder remains part of
[#12](https://github.com/AlexDorsten/hylo/issues/12).

## Create the browser token

Create an operator-owned [Mapbox account](https://account.mapbox.com/auth/signup/).
At the time of writing, demo access offers one token with usage limits; custom
tokens require standard access, which uses pay-as-you-go billing. Review the
[current account options](https://docs.mapbox.com/accounts/guides/demo-access/)
before choosing an account mode.

For production, create a dedicated public token beginning with `pk.`. Include
`styles:read` and `fonts:read` for the map styles and glyphs. Restrict allowed URLs
to the instance origin, for example `https://hylo.example.org`. Mapbox permits
subpaths of an allowed origin; do not append a wildcard. Use a separate token
for local development. The default public token cannot have URL restrictions.
See [Mapbox token management](https://docs.mapbox.com/accounts/guides/tokens/).

Keep the token in the operator's private deployment configuration, outside the
repository. Public tokens are intentionally visible in the browser bundle;
never use a secret `sk.` token in any `VITE_*` setting.

## Configure and rebuild

In the Compose `.env` file used for the image build, set:

```dotenv
VITE_MAPBOX_TOKEN=pk.REPLACE_WITH_YOUR_PUBLIC_TOKEN
```

This is a **build argument**, not a runtime web-server setting. Setting
`MAPBOX_TOKEN` in `backend.env`, restarting a container or pulling an image built
without the token does not configure the browser map. Build with the private
Compose environment that contains the value.

For the layout in the [installation guide](README.md), run from `deploy/docker`.
Retain the current image for rollback and select a new `HYLO_IMAGE` tag in `.env`
for this configuration revision. Use the same reviewed source revision as the
running installation for a token-only change:

```sh
docker compose --profile application --profile maintenance config --quiet
docker compose build api
docker compose --profile application up -d --no-deps api worker web
```

API, worker and web share one image in this Compose setup. This configuration
change needs neither a schema migration nor a new database bootstrap. For an
operator-specific Compose override or external `--env-file`, preserve those
same options on both the build and deployment commands.

## Verify in the browser

Open `/public/map`, then a group's map and location editor. Reload the page to
use the new assets. Verify that tiles and labels render, zoom/pan work and
location autocomplete returns a synthetic test location. Check that the missing
token error is gone. Treat any further errors separately:

- `401`: check whether the token is valid and active.
- `403`: check scopes, allowed origin and the request's `Referer` header.
- WebGL or network errors: check the browser and failed resource requests.

Test a URL-restricted token from the actual allowed browser origin. A bare
terminal request lacks that origin and can return `403` for a valid token.
See [Mapbox token troubleshooting](https://docs.mapbox.com/help/troubleshooting/token-errors/).
Keep request URLs containing tokens out of shared logs and screenshots.

## Backend geocoding is separate

`MAPBOX_TOKEN` in `backend.env` serves server-side geocoding, including group
locations and imports. It does not replace `VITE_MAPBOX_TOKEN`. A browser token
restricted by referring URL cannot simply be reused for these server requests.
If backend geocoding is needed, configure a separate least-privilege token and
verify that the account supports the requested API. The current group-location
job requests the legacy `mapbox.places-permanent` mode; rendering browser tiles
alone does not establish acceptance for this path.
