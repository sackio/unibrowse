#!/bin/bash
# Query macros for a specific site
# Usage: ./get-macros-for-site.sh [domain]

set -e

DOMAIN="${1:-*}"

# Check if MongoDB container is running
if ! docker ps | grep -q browser-mcp-mongodb; then
    echo "ERROR: MongoDB container 'browser-mcp-mongodb' is not running"
    echo "Start it with: docker compose up -d mongodb"
    exit 1
fi

echo "Querying macros for site: $DOMAIN"
echo ""

docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "
    const siteDomain = '$DOMAIN';
    const siteMacros = db.macros.find({site: siteDomain}).sort({category: 1, name: 1}).toArray();
    const universalMacros = db.macros.find({site: '*'}).sort({category: 1, name: 1}).toArray();

    print('=== Site: ' + siteDomain + ' ===');
    print('');

    if (siteMacros.length > 0) {
        print('Site-Specific Macros: ' + siteMacros.length);
        print('');
        siteMacros.forEach((m, idx) => {
            print((idx + 1) + '. ' + m.name + ' (' + m.category + ') [' + (m.reliability || 'untested') + ']');
            print('   ID: ' + m.id);
            print('   ' + m.description);
            const params = Object.keys(m.parameters || {});
            if (params.length > 0) {
                print('   Parameters: ' + params.join(', '));
            }
            print('');
        });
    } else {
        print('No site-specific macros found');
        print('');
    }

    if (universalMacros.length > 0) {
        print('Universal Macros: ' + universalMacros.length);
        print('');
        universalMacros.forEach((m, idx) => {
            print((idx + 1) + '. ' + m.name + ' (' + m.category + ')');
            print('   ID: ' + m.id);
            print('   ' + m.description);
            print('');
        });
    }

    print('Total available: ' + (siteMacros.length + universalMacros.length));
"
