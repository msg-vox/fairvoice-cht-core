#!/bin/sh

npm ci
npm run --prefix shared-libs/cht-datasource build
npm run build

export PATH=$PATH:$(pwd)/node_modules/.bin
which uglifyjs

BRANCH=fairvoice BUILD_NUMBER=1 ./scripts/build/build-service-images.sh
docker tag medicmobile/cht-api:5.3.1-fairvoice.1 registry.msg-vox.net/cht-api:5.3.1-fairvoice.1
docker push registry.msg-vox.net/cht-api:5.3.1-fairvoice.1
