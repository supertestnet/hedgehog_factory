var hedgehog_factory = {
    state: {},
    retrievables: {},
    waitSomeTime: num => new Promise( resolve => setTimeout( resolve, num ) ),
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    convertHMS: value => {
        if ( value < 0 ) value = 0;
        var sec = parseInt(value, 10); // convert value to number if it's string
        var years = Math.floor(sec / 31536000); // get years
        var months = Math.floor((sec - (years * 31536000)) / 2592000); // get months
        var days = Math.floor((sec - (years * 31536000) - (months * 2592000)) / 86400); // get days
        var hours = Math.floor((sec - (years * 31536000) - (months * 2592000) - (days * 86400)) / 3600); // get hours
        var minutes = Math.floor((sec - (years * 31536000) - (months * 2592000) - (days * 86400) - (hours * 3600)) / 60); // get minutes
        var seconds = sec - (years * 31536000) - (months * 2592000) - (days * 86400) - (hours * 3600) - (minutes * 60); //  get seconds
        var yearsstring = (years != 1) ? `years`:`year`;
        var monthsstring = (months != 1) ?  `months`:`month`;
        var daysstring = (days != 1) ? `days`:`day`;
        var hoursstring = (hours != 1) ? `hours`:`hour`;
        var minutesstring = (minutes != 1) ? `minutes`:`minute`;
        var secondsstring = (seconds != 1) ? `seconds`:`second`;
        return `${days} ${daysstring} ${minutes} ${minutesstring} ${seconds} seconds`;
    },
    hexToText: hex => {
        var bytes = new Uint8Array( Math.ceil( hex.length / 2 ) );
        var i; for ( i=0; i<hex.length; i++ ) bytes[ i ] = parseInt( hex.substr( i * 2, 2 ), 16 );
        var text = new TextDecoder().decode( bytes );
        return text;
    },
    textToHex: text => {
        var encoded = new TextEncoder().encode( text );
        return Array.from( encoded )
            .map( x => x.toString( 16 ).padStart( 2, "0" ) )
            .join( "" );
    },
    shuffle: array => {
        var secureRandom = () => Number( `0.${parseInt( hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 7 ) ) ), 16 )}` );
        array = JSON.parse( JSON.stringify( array ) );
        var currentIndex = array.length, randomIndex;
        // While there remain elements to shuffle.
        while ( currentIndex > 0 ) {
            // Pick a remaining element.
            randomIndex = Math.floor( secureRandom() * currentIndex );
            currentIndex--;
            // And swap it with the current element.
            [ array[ currentIndex ], array[ randomIndex ] ] = [
                array[ randomIndex ], array[ currentIndex ]
            ];
        }
        return array;
    },
    isValidAddress: address => {
        try {
            return !!tapscript.Address.decode( address ).script;
        } catch( e ) {return;}
        return;
    },
    isValidBitcoinKey: key => {
        if ( key.length != 64 && key.length != 66 ) return;
        if ( key.length === 64 ) key = "02" + key;
        try {
            return !!nobleSecp256k1.Point.fromCompressedHex( hedgehog_factory.hexToBytes( key ) );
        } catch ( e ) {
            return;
        }
    },
    getNote: async item => {
        async function isNoteSetYet( note_i_seek ) {
            return new Promise( function( resolve, reject ) {
                if ( !note_i_seek ) {
                    setTimeout( async function() {
                        var msg = await isNoteSetYet( hedgehog_factory.retrievables[ item ] );
                        resolve( msg );
                    }, 100 );
                } else {
                    resolve( note_i_seek );
                }
            });
        }
        async function getTimeoutData() {
            var note_i_seek = await isNoteSetYet( hedgehog_factory.retrievables[ item ] );
            return note_i_seek;
        }
        var returnable = await getTimeoutData();
        return returnable;
    },
    init: state_id => {
        hedgehog_factory.state[ state_id ] = {
            whos_here: {},
            who_should_pay: {},
            all_peers: [],
            ceremony_started: false,
            channel_cost: 1000,
            channel_size: 100_000,
            minimum: 3,
            maximum: 20,
            address_type: allover_network,
            relays: ["wss://nostrue.com"],
            privkey: hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 32 ) ) ),
            pubkey: null,
            scripts: [],
            script: [],
            tree: [],
            multisig: null,
            backup_pubkey: "a".repeat( 64 ),
            funding_tx: null,
            rounds: [],
            ejection_txs: [],
            round_sigs: [],
            midstate_scripts: [],
            midstate_trees: [],
            midstate_addresses: [],
            connector_utxos: [],
            user_ejection_sigs: [],
            connector_sigs: [],
            withdrawal_txids: [],
            sorted_round_sigs: [],
            sorted_user_ejection_sigs: [],
            sorted_connector_sigs: [],
            admin_pubkeys_for_hedgehog_channels: {},
            admin_privkey_for_own_hedgehog_channel: null,
            admin_preimage_for_own_hedgehog_channel: null,
            opening_info_for_hedgehog_channels: {},
            sig_timers: {},
            all_sigs_needed_by_admin: {},
            current_round: 0,
            amount_per_user_to_cover_p2a_costs: 240 * 2,
            average_bytesize_of_each_users_input: 200,
            routing_node: null,
            msg_id: state_id,
            node: null,
            initial_state_hash: null,
            signing_started: false,
            signing_finished: false,
            signing_progress: {},
            nwc_string: null,
            loop_delay: 5,
            amount_alice_expects_in_next_htlc: 0,
            pmthash_alice_expects_in_next_htlc: 0,
            users_to_delete: [],
            validating: false,
            admin_info_on_each_user: {},
        }
        var state = hedgehog_factory.state[ state_id ];
        if ( params[ "privkey" ] ) state.privkey = params[ "privkey" ];
        state.pubkey = nobleSecp256k1.getPublicKey( state.privkey, true ).substring( 2 );
        state.routing_node = params.hasOwnProperty( "routing_node" ) ? params.routing_node : state.pubkey;
        state.node = nostr_p2p( state.relays, state.privkey );
        $( '.channel_cost' ).innerText = state.channel_cost;
        $( '.channel_size' ).innerText = state.channel_size.toLocaleString();
    },
    whosHereCleaner: async state_id => {
        var now = Math.floor( Date.now() / 1000 );
        var state = hedgehog_factory.state[ state_id ];
        var whos_here = state.whos_here;
        if ( state.ceremony_started ) return;
        Object.keys( whos_here ).forEach( participant => {
            if ( now - whos_here[ participant ] > 30 ) delete whos_here[ participant ];
        });
        if ( Object.keys( whos_here ).length < 2 ) $( '.participant_count' ).innerText = `1 (just you)`;
        else $( '.participant_count' ).innerText = Object.keys( whos_here ).length;
        if ( params.hasOwnProperty( "admin" ) ) {
            if ( !Object.keys( whos_here ).length ) $( '.participant_count' ).innerText = `0 (it's just you)`;
            if ( Object.keys( whos_here ).length === 1 ) $( '.participant_count' ).innerText = 1;
        }
        await hedgehog_factory.waitSomeTime( 1000 );
        hedgehog_factory.whosHereCleaner( state_id );
    },
    setSigningTimer: async ( users, state_id, utxos_for_protocol, sats_per_byte, change_address ) => {
        var state = hedgehog_factory.state[ state_id ];
        var now = Math.floor( Date.now() / 1000 );
        var users_before_any_changes = JSON.parse( JSON.stringify( users ) );
        var sigs_needed = ( ( ( Object.keys( users ).length + 1 ) ** 2 ) * 2 ) + ( Object.keys( users ).length + 1 );
        var loop3 = async () => {
            if ( state.signing_finished ) return;
            await hedgehog_factory.waitSomeTime( 500 );
            if ( !state.users_to_delete.length ) return loop3();
            var users_to_delete = JSON.parse( JSON.stringify( state.users_to_delete ) );
            state.users_to_delete = [];
            users_to_delete.forEach( user => {
                delete state.who_should_pay[ user ];
                delete state.all_sigs_needed_by_admin[ user ];
                users.splice( users.indexOf( user ), 1 );
            });
            var randomized_peers = hedgehog_factory.shuffle( users );
            var msg = JSON.stringify({
                type: "official_peers_and_utxos_list",
                value: { randomized_peers, utxos_for_protocol, sats_per_byte, change_address },
            });
            users.push( state.pubkey );
            users.forEach( user => state.all_sigs_needed_by_admin[ user ] = [] );
            hedgehog_factory.setSigningTimer( randomized_peers, state_id, utxos_for_protocol, sats_per_byte, change_address );
            var node = state.node;
            var msg_id = state_id;
            if ( randomized_peers.length < state.minimum ) return alert( `abort because too few people were honest -- ${randomized_peers.length} were honest and the minimum is ${state.minimum}` );
            else node.relay( 'signing_phase', msg, randomized_peers, msg_id );
            showPage( 'view_signers' );
            hedgehog_factory.startSigning( msg, state_id );
            return;
        }
        loop3();
        users.forEach( async user => {
            state.sig_timers[ user ] = now;
            state.signing_progress[ user ] = 0;
            var loop = async () => {
                if ( state.validating ) {
                    await hedgehog_factory.waitSomeTime( 1_000 );
                    return loop();
                }
                if ( state.signing_finished ) return;
                //cancel the loop if another function added users to users_to_delete
                if ( state.users_to_delete.length ) return;
                //cancel the loop if all sigs are acquired
                if ( !state.all_sigs_needed_by_admin.hasOwnProperty( user ) ) state.all_sigs_needed_by_admin[ user ] = [];
                if ( state.all_sigs_needed_by_admin[ user ].length === sigs_needed ) return;
                //cancel the loop if this user is no longer part of the group
                var users_in_group = Object.keys( state.who_should_pay );
                if ( !users_in_group.includes( user ) ) return;
                //get the current states
                user_state = state.signing_progress[ user ];
                //wait 10 seconds
                await hedgehog_factory.waitSomeTime( 10_000 );
                if ( state.validating ) return loop();
                if ( state.signing_finished ) return;
                //again, cancel the loop if another function added users to users_to_delete
                if ( state.users_to_delete.length ) return;
                //again, cancel the loop if all sigs are acquired
                if ( state.all_sigs_needed_by_admin[ user ].length === sigs_needed ) return;
                //check if the user's state changed
                var state_changed = !( user_state === state.signing_progress[ user ] );
                //if not, kick them out, otherwise, loop
                if ( !state_changed ) {
                    delete state.who_should_pay[ user ];
                    delete state.all_sigs_needed_by_admin[ user ];
                    users.splice( users.indexOf( user ), 1 );
                    return;
                } else {
                    return loop();
                }
            }
            loop();
        });
        var loop2 = async () => {
            await hedgehog_factory.waitSomeTime( 10_000 );
            if ( state.signing_finished ) return;
            //cancel the loop if another function added users to users_to_delete
            if ( state.users_to_delete.length ) return;
            //restart the loop if we're validating signatures
            if ( state.validating ) return loop2();
            //if something changed, rerun startSigning
            if ( JSON.stringify( users.sort() ) !== JSON.stringify( users_before_any_changes.sort() ) ) {
                // users.splice( 0, 1 );
                var randomized_peers = hedgehog_factory.shuffle( users );
                var msg = JSON.stringify({
                    type: "official_peers_and_utxos_list",
                    value: { randomized_peers, utxos_for_protocol, sats_per_byte, change_address },
                });
                users.push( state.pubkey );
                users.forEach( user => state.all_sigs_needed_by_admin[ user ] = [] );
                hedgehog_factory.setSigningTimer( randomized_peers, state_id, utxos_for_protocol, sats_per_byte, change_address );
                var node = state.node;
                var msg_id = state_id;
                if ( randomized_peers.length < state.minimum ) return alert( `abort because too few people were honest -- ${randomized_peers.length} were honest and the minimum is ${state.minimum}` );
                else node.relay( 'signing_phase', msg, randomized_peers, msg_id );
                hedgehog_factory.startSigning( msg, state_id );
                return;
            }
            return loop2();
        }
        await loop2();
    },
    startSigning: async ( official_peers_and_utxos_list, state_id ) => {
        var peers_and_utxos = JSON.parse( official_peers_and_utxos_list );
        var peers = peers_and_utxos.value.randomized_peers;
        var utxos = peers_and_utxos.value.utxos_for_protocol;
        var sats_per_byte = peers_and_utxos.value.sats_per_byte;
        var change_address = peers_and_utxos.value.change_address;
        var state = hedgehog_factory.state[ state_id ];
        var privkey = state.privkey;
        var pubkey = state.pubkey;
        var node = state.node;
        var address_type = state.address_type;
        var routing_node = state.routing_node;
        var funding_amount = state.channel_size;
        var channel_size = state.channel_size;
        var amount_per_user_to_cover_p2a_costs = state.amount_per_user_to_cover_p2a_costs;
        var backup_pubkey = state.backup_pubkey;
        var msg_id = state_id;
        state.validating = false;
        state.signing_started = true;
        state.scripts = [];
        state.script = [];
        state.tree = [];
        state.multisig = null;
        state.funding_tx = null;
        state.rounds = [];
        state.ejection_txs = [];
        state.round_sigs = [];
        state.midstate_scripts = [];
        state.midstate_trees = [];
        state.midstate_addresses = [];
        state.connector_utxos = [];
        state.user_ejection_sigs = [];
        state.connector_sigs = [];
        state.withdrawal_txids = [];
        state.sorted_round_sigs = [];
        state.sorted_user_ejection_sigs = [];
        state.sorted_connector_sigs = [];
        if ( Object.keys( state.opening_info_for_hedgehog_channels ).length ) {
            var chan_ids = [];
            Object.keys( state.opening_info_for_hedgehog_channels ).forEach( opener => chan_ids.push( state.opening_info_for_hedgehog_channels[ opener ].chan_id ) );
            state.opening_info_for_hedgehog_channels = {}
            chan_ids.forEach( chan_id => delete hedgehog.state[ chan_id ] );
        }

        //if you are the admin, clear your hedgehog.keypairs object and insert the keypairs
        //belonging to the people who paid and have not been kicked out
        if ( params.hasOwnProperty( "admin" ) ) {
            var who_should_pay = state.who_should_pay;
            hedgehog.keypairs = {}
            peers.forEach( peer => {
                if ( peer === pubkey ) {
                    var preimage_for_hedgehog = state.admin_preimage_for_own_hedgehog_channel;
                    var privkey_for_hedgehog = state.admin_privkey_for_own_hedgehog_channel;
                }
                var preimage_for_hedgehog = who_should_pay[ peer ][ 2 ];
                var privkey_for_hedgehog = who_should_pay[ peer ][ 3 ];
                var pubkey_for_hedgehog = nobleSecp256k1.getPublicKey( privkey_for_hedgehog, true ).substring( 2 );
                hedgehog.keypairs[ pubkey_for_hedgehog ] = {
                    privkey: privkey_for_hedgehog,
                    preimage: preimage_for_hedgehog,
                }
                if ( !state.all_sigs_needed_by_admin.hasOwnProperty( peer ) ) state.all_sigs_needed_by_admin[ peer ] = [];
            });
        }

        // Have every party insert the admin’s pubkey at the top of the pubkeys list
        peers.unshift( routing_node );
        state.all_peers = JSON.parse( JSON.stringify( peers ) );
        var all_peers = state.all_peers;

        $( '.view_signers' ).innerHTML = ``;
        peers.forEach( peer => {
            var signer = `
                <div class="signer signer_${peer}">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg">
                    <p>${peer.substring( 0, 4 ) + "..." + peer.substring( peer.length - 4 )}</p>
                    <div class="progress">
                        <p style="font-weight: bold;">Progress bar <span id="goal" style="font-size: .8em; font-weight: normal;"></span></p>
                        <div class="progressOutline" style="height: 2em; border: 1px solid grey; border-radius: 25px; overflow: hidden;">
                            <div class="progressBar" style="height: 2em; background-color: #61eb34; width: 0%; transition: width 1s;">
                            </div>
                        </div>
                        <div class="status"></div>
                    </div>
                </div>
            `;
            var signer_div = document.createElement( "div" );
            signer_div.innerHTML = signer;
            $( '.view_signers' ).append( signer_div.firstElementChild );
        });
        showPage( 'view_signers' );

        // Have every party independently validate that the list has no repeats
        var duplicates = peers.filter( ( item, index ) => peers.indexOf( item ) !== index );
        if ( duplicates.length ) return alert( `aborting because the admin scammed you by including some people twice in the multisig. Your money is probably gone forever.` );
        // Have every party independently validate that their pubkey is in the list
        if ( !peers.includes( pubkey ) ) return alert( `aborting because the admin scammed you by not including you in the multisig. Your money is probably gone forever.` );

        // Have every party independently validate that all pubkeys in the list are valid
        var all_keys_are_valid = true;
        peers.forEach( key => {
            if ( !hedgehog_factory.isValidBitcoinKey( key ) ) all_keys_are_valid = false;
        });
        if ( !all_keys_are_valid ) return alert( `aborting because the admin scammed you by sending you a list of peers with invalid keys. Your money is probably gone forever.`);

        // TODO: Have every party independently validate that those utxos exist
        // Have every party independently validate that those utxos are in segwit addresses (v0 or v1)
        var all_addys_are_segwit = true;
        var addys_in_utxo_list = [];
        utxos.forEach( utxo => addys_in_utxo_list.push( utxo[ "addy" ] ) );
        addys_in_utxo_list.forEach( addy => {
            if ( !addy.startsWith( "bc1" ) && !addy.startsWith( "tb1" ) && !addy.startsWith( "bcrt1" ) ) all_addys_are_segwit = false;
        });
        if ( !all_addys_are_segwit ) return alert( `aborting because the admin scammed you by not using segwit addresses to fund the multisig, which means anyone can render all signatures invalid while the funding transaction is still in the mempool. Your money is probably gone forever.` );

        // Have every party independently validate that the utxos contain enough money to fund the multisig
        var required_sum = ( channel_size * peers.length ) + ( amount_per_user_to_cover_p2a_costs * peers.length ) + 830;
        var actual_sum = 0;
        utxos.forEach( utxo => actual_sum = actual_sum + utxo[ "amnt" ] );
        if ( actual_sum < required_sum ) return alert( `aborting because the admin scammed you by not providing enough money to fund the multisig, which means the funding transaction won't be valid. Your money is probably gone forever.` );

        // Have every party independently validate that the feerate chosen is sufficient
        // TODO: actually check a feerate source and ensure the feerate chosen is at or above the fast-track option
        if ( sats_per_byte < 1 ) return alert( `aborting because the admin scammed you by telling you to use an insufficient feerate, which means the funding transaction will probably never get mined. Your money is probably gone forever.` );

        // Have every party independently validate that the change address is valid
        if ( !hedgehog_factory.isValidAddress( change_address ) ) return alert( `aborting because the admin scammed you by telling you to send their change to an invalid bitcoin address, which means the funding transaction won't be valid. Your money is probably gone forever.` );

        // Have every party independently create an n of n multisig owned by the pubkeys mentioned in the first bullet point of this section
        var scripts = state.scripts;
        var script = state.script;
        var tree = state.tree;
        peers.forEach( ( key, index ) => script.push( key, "OP_CHECKSIGVERIFY" ) );
        script.pop();
        script.push( "OP_CHECKSIG" );
        scripts.push( script );
        tree = scripts.map( s => tapscript.Tap.encodeScript( s ) );
        state.tree = tree;
        var tapleaf = tree[ 0 ];
        var [ tpubkey ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree });
        var multisig = tapscript.Address.p2tr.fromPubKey( tpubkey, address_type );
        state.multisig = multisig;

        // Have every party independently create the 1-or-2 output transaction depositing the right amount of money into the multisig and giving the change, if any, back to the admin
        var vin = [];
        utxos.forEach( utxo => {
            vin.push({
                txid: utxo[ "txid" ],
                vout: utxo[ "vout" ],
                prevout: {
                    value: utxo[ "amnt" ],
                    scriptPubKey: tapscript.Address.toScriptPubKey( utxo[ "addy" ] ),
                }
            });
        });
        var change_amnt = actual_sum - ( required_sum - 830 );
        var vout = [{
            value: required_sum - 830,
            scriptPubKey: tapscript.Address.toScriptPubKey( multisig ),
        }];
        // TODO: ensure you apply the tx fee per the feerate value
        if ( change_amnt >= 830 ) vout.push({
            value: change_amnt - 500,
            scriptPubKey: tapscript.Address.toScriptPubKey( change_address ),
        });
        var funding_tx = tapscript.Tx.create({
            vin,
            vout,
        });
        state.funding_tx = funding_tx;
        var num_of_users = peers.length;

        // Have every party prepare the midstate scripts
        var midstate_scripts = state.midstate_scripts;
        var i; for ( i=0; i<num_of_users; i++ ) {
            var scripts_for_this_midstate = [];
            var j; for ( j=0; j<num_of_users; j++ ) {
                var midstate_script = JSON.parse( JSON.stringify( script ) );
                scripts_for_this_midstate.push( midstate_script );
            }
            midstate_scripts.push( scripts_for_this_midstate );
        }

        // Have every party prepare the midstate addresses
        var midstate_trees = state.midstate_trees;
        var midstate_addresses = state.midstate_addresses;
        midstate_scripts.forEach( scripts => {
            var midstate_tree = scripts.map( s => tapscript.Tap.encodeScript( s ) );
            midstate_trees.push( midstate_tree );
            var [ tpubkey ] = tapscript.Tap.getPubKey( backup_pubkey, { tree: midstate_tree });
            var midstate_address = tapscript.Address.p2tr.fromPubKey( tpubkey, address_type );
            midstate_addresses.push( midstate_address );
        });

        // Have every party independently create a 10 step “exit ladder” using my tornado factory protocol so that the money for each participant is guaranteed to end up in a 2 of 2 multisig “owned by” that participant’s pubkey and the admin's
        var every_partys_2_of_2 = [];
        all_peers.forEach( ( key, index ) => {
            var admins_pubkey_for_hedgehog_channel = state.admin_pubkeys_for_hedgehog_channels[ key ];
            var two_of_two_script = [ key, "OP_CHECKSIGVERIFY", admins_pubkey_for_hedgehog_channel, "OP_CHECKSIG" ];
            var two_of_two_tree = [ tapscript.Tap.encodeScript( two_of_two_script ) ];
            var two_of_two_addy = hedgehog.makeAddress( [ two_of_two_script ] );
            every_partys_2_of_2.push( two_of_two_addy );
        });
        // Generate n presigned txs, to which each user gets a copy
        var rounds = state.rounds;
        var round_sigs = state.round_sigs;
        var i; for ( i=0; i<num_of_users; i++ ) {
            //i represents the round
            var txid = rounds.length ? tapscript.Tx.util.getTxid( rounds[ rounds.length - 1 ] ) : tapscript.Tx.util.getTxid( funding_tx );
            var round = tapscript.Tx.create({
                version: 3,
                vin: [{
                    txid,
                    vout: rounds.length ? 2 : 0,
                    prevout: rounds.length ? rounds[ rounds.length - 1 ].vout[ 2 ] : funding_tx.vout[ 0 ],
                }],
                vout: [{
                    value: 240,
                    scriptPubKey: "51024e73",
                },{
                    value: funding_amount + amount_per_user_to_cover_p2a_costs - 330 - 240,
                    scriptPubKey: tapscript.Address.toScriptPubKey( midstate_addresses[ i ] ),
                }],
            });
            if ( i !== num_of_users - 1 ) {
                round.vout.push({
                    value: ( funding_amount * num_of_users ) + ( amount_per_user_to_cover_p2a_costs * num_of_users ) - ( funding_amount * ( i + 1 ) ) - ( amount_per_user_to_cover_p2a_costs * ( i + 1 ) ) - ( 330 * num_of_users ),
                    scriptPubKey: tapscript.Address.toScriptPubKey( multisig ),
                });
            }
            if ( !i ) {
                var j; for ( j=0; j<num_of_users; j++ ) {
                    round.vout.push({
                        value: 330,
                        scriptPubKey: tapscript.Address.toScriptPubKey( multisig ),
                    });
                }
            }
            var connector_utxos = state.connector_utxos;
            if ( !i ) {
                var j; for ( j=0; j<num_of_users; j++ ) {
                    connector_utxos.push({
                        txid: tapscript.Tx.util.getTxid( round ),
                        vout: j + 3,
                        prevout: round.vout[ j + 3 ],
                    });
                }
            }
            var sigs = [];
            var tapleaf = tree[ 0 ];
            var sighash = tapscript.Signer.taproot.hash( round, 0, { extension: tapleaf }).hex;
            var sig = tapscript.Signer.taproot.sign( privkey, round, 0, { extension: tapleaf }).hex;
            if ( params.cheater ) sig = 'a'.repeat( 128 );
            sigs.push( sig );
            rounds.push( round );
            round_sigs.push( sigs );
        }
        //allow each user to unilaterally exit in each round
        //each user needs the ability to withdraw from the midstate in any round
        //therefore, I must make n*n*n sigs -- there are n users who need to exit
        //and n rounds to exit in, and each user, in order to exit in that round,
        //needs n sigs
        //each key needs to sign n*n ejection transactions
        //the ejection transaction is different for each user
        //in each round so let's make the other two loops
        var totalnum = 0;
        var user_ejection_sigs = state.user_ejection_sigs;
        var connector_sigs = state.connector_sigs;
        var ejection_txs = state.ejection_txs;
        var withdrawal_txids = state.withdrawal_txids;
        var i; for ( i=0; i<num_of_users; i++ ) {
            if ( !i ) console.log( `0 out of ${( num_of_users ** 2 ) * 2} signatures created` );
            //in the codeblock beginning above, i represents a round
            var all_ejection_sigs_for_this_round = [];
            var all_connector_sigs_for_this_round = [];
            var all_withdrawal_txids_for_this_round = [];
            var all_ejection_txs_for_this_round = [];
            var data_is_sent = false;
            var j; for ( j=0; j<num_of_users; j++ ) {
                //in the codeblock beginning above, j represents a user
                var eject_user_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [{
                        txid: tapscript.Tx.util.getTxid( rounds[ i ] ),
                        vout: 1,
                        prevout: rounds[ i ].vout[ 1 ],
                    }],
                    vout: [{
                        value: 240,
                        scriptPubKey: "51024e73",
                    },{
                        //note that the round made an output of funding_amount - 240
                        //and this tx is spending that and taking out an *additional*
                        //240 for output 0 -- so it's funding_amount - 240 - 240
                        value: funding_amount + amount_per_user_to_cover_p2a_costs - 240 - 240,
                        scriptPubKey: tapscript.Address.toScriptPubKey( every_partys_2_of_2[ j ] ),
                    }],
                });
                eject_user_tx.vin.push( connector_utxos[ j ] );
                var txid_of_this_withdrawal_tx = tapscript.Tx.util.getTxid( eject_user_tx );
                all_withdrawal_txids_for_this_round.push( txid_of_this_withdrawal_tx );
                all_ejection_txs_for_this_round.push( eject_user_tx );
                //I will use the tapleaf that lets one user alone leave after revealing his or her first withdrawal secret
                //in round 1, the tapleaf I need for the first user is midstate_trees[ 0 ][ 0 ]
                //in round 1, the tapleaf I need for the second user is midstate_trees[ 0 ][ 1 ]
                //etc.
                //in round 2, the tapleaf I need for the first user is midstate_trees[ 1 ][ 0 ]
                //in round 2, the tapleaf I need for the second user is midstate_trees[ 1 ][ 1 ]
                //etc.
                var midstate_tapleaf = midstate_trees[ i ][ j ];
                var connector_tapleaf = tree[ 0 ];
                var backup_pubkey = state.backup_pubkey;
                var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree: midstate_trees[ i ] });
                var sigs_for_this_user_for_this_round = [];
                var connector_sigs_for_this_user_for_this_round = [];
                var sig = tapscript.Signer.taproot.sign( privkey, eject_user_tx, 0, { extension: midstate_tapleaf } ).hex;
                totalnum = totalnum + 1;
                console.log( `${totalnum} out of ${( num_of_users ** 2 ) * 2} signatures created` );
                sigs_for_this_user_for_this_round.push( sig );
                var connector_sig = tapscript.Signer.taproot.sign( privkey, eject_user_tx, 1, { extension: connector_tapleaf } ).hex;
                totalnum = totalnum + 1;
                console.log( `${totalnum} out of ${( num_of_users ** 2 ) * 2} signatures created` );
                if ( String( totalnum ).endsWith( "00" ) && !data_is_sent && peers[ 0 ] !== pubkey ) {
                    data_is_sent = true;
                    node.send( 'signing_progress', String( totalnum ), peers[ 0 ], msg_id );
                }
                if ( params.hasOwnProperty( "admin" ) ) {
                    var signing_progress = hedgehog_factory.state[ state_id ].signing_progress;
                    signing_progress[ pubkey ] = totalnum;
                    var total_needed = ( num_of_users ** 2 ) * 2;
                    $( `.signer_${pubkey} .progressBar` ).style.width = `${( totalnum / total_needed ) * 100}%`;
                }
                connector_sigs_for_this_user_for_this_round.push( connector_sig );
                all_ejection_sigs_for_this_round.push( sigs_for_this_user_for_this_round );
                all_connector_sigs_for_this_round.push( connector_sigs_for_this_user_for_this_round );
            }
            if ( i === num_of_users - 1 ) console.log( 'done!' );
            user_ejection_sigs.push( all_ejection_sigs_for_this_round );
            connector_sigs.push( all_connector_sigs_for_this_round );
            ejection_txs.push( all_ejection_txs_for_this_round );
            withdrawal_txids.push( all_withdrawal_txids_for_this_round );
        }
        // Have every party (except the admin) give the admin their signatures and any data needed to unilaterally eject them from the multisig
        var sigs_to_send = [];
        round_sigs.forEach( sig_array => sigs_to_send.push( sig_array[ 0 ] ) );
        var i; for ( i=0; i<user_ejection_sigs.length; i++ ) {
            var j; for ( j=0; j<user_ejection_sigs[ i ].length; j++ ) {
                sigs_to_send.push( user_ejection_sigs[ i ][ j ][ 0 ] );
            }
        }
        var i; for ( i=0; i<connector_sigs.length; i++ ) {
            var j; for ( j=0; j<connector_sigs[ i ].length; j++ ) {
                sigs_to_send.push( connector_sigs[ i ][ j ][ 0 ] );
            }
        }
        // Have every party give the admin signatures and hashes which, per my hedgehog protocol, allow the admin to create an initial state for the 2 of 2 multisig such that the admin can withdraw everything from it
        var my_usernum = all_peers.indexOf( pubkey );
        var counterpartys_pubkey = state.admin_pubkeys_for_hedgehog_channels[ all_peers[ my_usernum ] ];
        var initial_state_hash = state.initial_state_hash;
        var bobs_pubkey_and_hash = [ counterpartys_pubkey, initial_state_hash ];
        var push_all_funds_to_counterparty = true;
        var opening_info_for_hedgehog_channels = state.opening_info_for_hedgehog_channels;
        if ( !opening_info_for_hedgehog_channels.hasOwnProperty( pubkey ) ) opening_info_for_hedgehog_channels[ pubkey ] = [];
        var i; for ( i=0; i<all_peers.length; i++ ) {
            var txid = state.withdrawal_txids[ i ][ my_usernum ];
            var vout = 1;
            var amnt = funding_amount + amount_per_user_to_cover_p2a_costs - 240 - 240;
            var opening_info = await hedgehog.openChannel( push_all_funds_to_counterparty, bobs_pubkey_and_hash, null, null, null, null, null, privkey, [txid, vout, amnt] );
            opening_info_for_hedgehog_channels[ pubkey ].push( opening_info );
        }
        // Send the data to the admin or, if you are the admin, save your own data
        var all_sigs_needed_by_admin = state.all_sigs_needed_by_admin;
        if ( peers[ 0 ] !== pubkey ) node.send( 'sigs', JSON.stringify({ sigs_to_send, opening_info_for_hedgehog_channels: opening_info_for_hedgehog_channels[ pubkey ] }), peers[ 0 ], msg_id );
        else all_sigs_needed_by_admin[ pubkey ] = sigs_to_send;
        // Then have the admin broadcast the funding transaction and the protocol is done
    },
    validateAndBroadcast: async state_id => {
        var state = hedgehog_factory.state[ state_id ];
        var all_peers = state.all_peers;
        var sorted_round_sigs = state.sorted_round_sigs;
        var sorted_user_ejection_sigs = state.sorted_user_ejection_sigs;
        var sorted_connector_sigs = state.sorted_connector_sigs;
        var ejection_txs = state.ejection_txs;
        var midstate_trees = state.midstate_trees;
        var tree = state.tree;
        var privkey = state.privkey;
        var funding_tx = state.funding_tx;
        var rounds = state.rounds;
        var num_of_round_sigs_in_each_set = all_peers.length;
        var all_sigs_needed_by_admin = state.all_sigs_needed_by_admin;
        var who_should_pay = state.who_should_pay;
        var unsorted_sigs = JSON.parse( JSON.stringify( all_sigs_needed_by_admin ) );
        var round_sigs = [];
        var user_ejection_sigs = [];
        var connector_sigs = [];
        var total_validated = 0;
        var total_needed = 0;
        var msg_id = state.msg_id;
        var node = state.node;
        state.validating = true;
        var peers_to_message = JSON.parse( JSON.stringify( all_peers ) );
        peers_to_message.splice( 0, 1 );
        Object.keys( all_sigs_needed_by_admin ).forEach( user => total_needed = total_needed + all_sigs_needed_by_admin[ user ].length );
        all_peers.forEach( peer => {
            //the first array in round_sigs will contain n sigs by the first user,
            //each of which creates one of the n midstates
            round_sigs.push( [ ...unsorted_sigs[ peer ].splice( 0, all_peers.length ) ] );
            user_ejection_sigs.push( [ ...unsorted_sigs[ peer ].splice( 0, all_peers.length ** 2 ) ] );
            connector_sigs.push( [ ...unsorted_sigs[ peer ].splice( 0, all_peers.length ** 2 ) ] );
        });
        // console.log( 0 );
        // console.log( 13, round_sigs );
        // console.log( 14, user_ejection_sigs );
        // console.log( 15, connector_sigs );
        var i; for ( i=0; i<round_sigs.length; i++ ) {
            var sorted = [];
            var j; for ( j=0; j<round_sigs.length; j++ ) sorted.push( round_sigs[ j ][ i ] );
            sorted_round_sigs.push( sorted );
        }
        var naughty_peers = [];
        var i; for ( i=0; i<sorted_round_sigs.length; i++ ) {
            //i represents the round
            var sig_array = sorted_round_sigs[ i ];
            var round = rounds[ i ];
            var target = tree[ 0 ];
            var sighash = tapscript.Signer.taproot.hash( round, 0, { extension: target }).hex;
            var j; for ( j=0; j<sig_array.length; j++ ) {
                //j represents the user whose sig we are checking
                //and we skip checking our own
                if ( !j ) continue;
                var sig = sig_array[ j ];
                if ( sig.length !== 128 || !hedgehog.isValidHex( sig ) && !naughty_peers.includes( all_peers[ j ] ) ) {
                    naughty_peers.push( all_peers[ j ] );
                    break;
                }
                var is_valid = await nobleSecp256k1.schnorr.verify( sig, sighash, all_peers[ j ] );
                if ( !is_valid && !naughty_peers.includes( all_peers[ j ] ) ) naughty_peers.push( all_peers[ j ] );
                total_validated = total_validated + 1;
                var progress = Number( ( ( ( total_validated / total_needed ) ) * 100 ).toFixed( 2 ) );
                $( '.validation_phase .progressBar' ).style.width = `${progress}%`;
                if ( Math.floor( ( total_validated / total_needed ) * 100 ) % 5 === 0 ) {
                    node.relay( 'validation_progress', JSON.stringify( [ total_validated, total_needed ] ), peers_to_message, msg_id );
                }
            }
        }
        if ( naughty_peers.length ) {
            state.users_to_delete = naughty_peers;
            return;
        }
        //the following loop makes it so that the first n sig_arrays in the
        //sorted_user_ejection_sigs array and in the sorted_connector_sigs array
        //eject all users from the first round, in the order given by all_peers
        //(so the first array ejects user 1, the second array ejects user 2, etc.)
        //the second n sig_arrays eject all users from the second round, etc.
        //this should make it easy to make buttons to eject any user from any round
        //if we are in the first round, I can have buttons to eject user 1, user 2,
        //etc. and each one just grabs the next sig_array and makes a tx using them
        //when the first round is done I can discard the first n sig_arrays and keep
        //the rest of the code the same, and keep repeating that for all rounds
        var i; for ( i=0; i<all_peers.length ** 2; i++ ) {
            var sorted_1 = [];
            var sorted_2 = [];
            var j; for ( j=0; j<user_ejection_sigs.length; j++ ) {
                sorted_1.push( user_ejection_sigs[ j ][ i ] );
                sorted_2.push( connector_sigs[ j ][ i ] );
            }
            sorted_user_ejection_sigs.push( sorted_1 );
            sorted_connector_sigs.push( sorted_2 );
        }
        //now I take the sorted_user_ejection_sigs and sorted_connector_sigs and group
        //their sig_arrays by round
        var grouped_1 = [];
        var grouped_2 = [];
        var i; for ( i=0; i<all_peers.length; i++ ) {
            var round_group_1 = [ ...sorted_user_ejection_sigs.splice( 0, all_peers.length ) ];
            var round_group_2 = [ ...sorted_connector_sigs.splice( 0, all_peers.length ) ];
            grouped_1.push( round_group_1 );
            grouped_2.push( round_group_2 );
        }
        sorted_user_ejection_sigs = grouped_1;
        state.sorted_user_ejection_sigs = sorted_user_ejection_sigs;
        sorted_connector_sigs = grouped_2;
        state.sorted_connector_sigs = sorted_connector_sigs;
        var sigs_to_send = {}
        all_peers.forEach( peer => sigs_to_send[ peer ] = {});
        var i; for ( i=0; i<ejection_txs.length; i++ ) {
            //i represents a round
            var sig_array_1 = sorted_user_ejection_sigs[ i ];
            var sig_array_2 = sorted_connector_sigs[ i ];
            var j; for ( j=0; j<all_peers.length; j++ ) {
                //j represents the user being ejected
                var ejection_tx = ejection_txs[ i ][ j ];
                var ejection_sigs_for_this_user = sig_array_1[ j ];
                var connector_sigs_for_this_user = sig_array_2[ j ];
                if ( !j ) sigs_to_send[ all_peers[ j ] ][ "ejection_sigs" ] = sig_array_1[ j ];
                if ( !j ) sigs_to_send[ all_peers[ j ] ][ "connector_sigs" ] = sig_array_2[ j ];
                var midstate_tapleaf = midstate_trees[ i ][ j ];
                var connector_tapleaf = tree[ 0 ];
                var midstate_sighash = tapscript.Signer.taproot.hash( ejection_tx, 0, { extension: midstate_tapleaf });
                var connector_sighash = tapscript.Signer.taproot.hash( ejection_tx, 1, { extension: connector_tapleaf });
                var k; for ( k=0; k<ejection_sigs_for_this_user.length; k++ ) {
                    //k represents the user whose sig we are checking
                    //and we skip checking our own
                    if ( !k ) continue;
                    var sig_1 = ejection_sigs_for_this_user[ k ];
                    if ( sig_1.length !== 128 || !hedgehog.isValidHex( sig_1 ) && !naughty_peers.includes( all_peers[ j ] ) ) {
                        naughty_peers.push( all_peers[ j ] );
                        break;
                    }
                    var is_valid_1 = await nobleSecp256k1.schnorr.verify( sig_1, midstate_sighash, all_peers[ k ] );
                    if ( !is_valid_1 && !naughty_peers.includes( all_peers[ k ] ) ) naughty_peers.push( all_peers[ k ] );
                    total_validated = total_validated + 1;
                    var progress = Number( ( ( ( total_validated / total_needed ) ) * 100 ).toFixed( 2 ) );
                    $( '.validation_phase .progressBar' ).style.width = `${progress}%`;
                    if ( Math.floor( ( total_validated / total_needed ) * 100 ) % 5 === 0 ) {
                        node.relay( 'validation_progress', JSON.stringify( [ total_validated, total_needed ] ), peers_to_message, msg_id );
                    }
                    var sig_2 = connector_sigs_for_this_user[ k ];
                    if ( sig_2.length !== 128 || !hedgehog.isValidHex( sig_2 ) && !naughty_peers.includes( all_peers[ j ] ) ) {
                        naughty_peers.push( all_peers[ j ] );
                        break;
                    }
                    var is_valid_2 = await nobleSecp256k1.schnorr.verify( sig_2, connector_sighash, all_peers[ k ] );
                    if ( !is_valid_2 && !naughty_peers.includes( all_peers[ k ] ) ) naughty_peers.push( all_peers[ k ] );
                    total_validated = total_validated + 1;
                    var progress = Number( ( ( ( total_validated / total_needed ) ) * 100 ).toFixed( 2 ) );
                    $( '.validation_phase .progressBar' ).style.width = `${progress}%`;
                    if ( Math.floor( ( total_validated / total_needed ) * 100 ) % 5 === 0 ) {
                        node.relay( 'validation_progress', JSON.stringify( [ total_validated, total_needed ] ), peers_to_message, msg_id );
                    }
                }
            }
        }
        if ( naughty_peers.length ) {
            state.users_to_delete = naughty_peers;
            return;
        }
        // console.log( 1 );
        // console.log( sorted_round_sigs );
        // console.log( sorted_user_ejection_sigs );
        // console.log( sorted_connector_sigs );
        // ensure each channel opening transaction is valid
        var i; for ( i=0; i<all_peers.length; i++ ) {
            //i represents the peer
            //you do not need to validate your own sigs
            if ( !i ) continue;
            var peer = all_peers[ i ];
            var pubkey_i_am_using_in_this_channel = nobleSecp256k1.getPublicKey( who_should_pay[ peer ][ 3 ], true ).substring( 2 );
            var j; for ( j=0; j<all_peers.length; j++ ) {
                //j represents the channel being validated,
                //aka the round it get opened out during,
                //keeping in mind that each party created n
                //potential channels depending on which
                //withdrawal tx he ends up getting, and we
                //must validate each one
                var channel_info = state.opening_info_for_hedgehog_channels[ peer ][ j ];
                //do not let users overwrite a channel you already validated
                if ( hedgehog.state.hasOwnProperty( channel_info.chan_id ) ) {
                    naughty_peers.push( peer );
                    break;
                }
                //ensure each user signed correct info about their channel
                var txid_for_this_channel = state.withdrawal_txids[ j ][ i ];
                channel_info[ "recipient_pubkey" ] = pubkey_i_am_using_in_this_channel;
                channel_info.utxo_info[ "txid" ] = txid_for_this_channel;
                channel_info.utxo_info[ "vout" ] = 1;
                channel_info.utxo_info[ "amnt" ] = state.channel_size;
                channel_info.sender_pubkey = peer;
                var skip_alert = true;
                var channel_is_valid = await hedgehog.openChannel( null, null, null, null, null, null, channel_info, null, null, skip_alert );
                if ( !channel_is_valid && !naughty_peers.includes( peer ) ) naughty_peers.push( peer );
            }
        }
        if ( naughty_peers.length ) {
            state.users_to_delete = naughty_peers;
            return;
        }
        var i; for ( i=0; i<all_peers.length; i++ ) {
            var peer = all_peers[ i ];
            var div = document.createElement( "div" );
            div.innerHTML = `
                <div class="ejectable_user user_${peer}">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/a/ac/Default_pfp.jpg">
                    <p>${peer.substring( 0, 4 ) + "..." + peer.substring( peer.length - 4 )}</p>
                    <p>Balance: <span class="user_balance">0</span> sats</p>
                    <p>PnL: <span class="pnl">0</span> sats</p>
                    <p><button class="view_profits" data-user="${peer}" data-state_id="${state_id}">View profits</button></p>
                    <p><button class="view_losses" data-user="${peer}" data-state_id="${state_id}">View losses</button></p>
                    <p><button onclick="hedgehog_factory.ejectUser( ${i}, '${state_id}' );" class="eject_user_btn">Eject user ${i + 1}</button></p>
                </div>
            `;
            $( '.ejection_buttons' ).append( div.firstElementChild );
        }
        $$( '.view_profits' ).forEach( ( item, index ) => {
            if ( !index ) {
                item.disabled = true;
                return;
            }
            item.onclick = e => {
                var state_id = e.target.getAttribute( "data-state_id" );
                var user = e.target.getAttribute( "data-user" );
                var profits = hedgehog_factory.state[ state_id ].admin_info_on_each_user[ user ].profits;
                var div = document.createElement( "div" );
                var html = ``;
                profits.forEach( item => {
                    html = html + `
                        <div class="pnl_listing">
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Label</p>
                                <p>${item[ "label" ] || '[None]'}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Txhash</p>
                                <p>${item[ "txhash" ] || '[None]'}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Kind</p>
                                <p>${item[ "kind" ]}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Gain</p>
                                <p>${item[ "gain" ]} sats</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Description</p>
                                <p>${item[ "desc" ] || '[None]'}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Time</p>
                                <p>${item[ "time" ]}</p>
                            </div>
                        </div>
                    `
                });
                showModal( html );
            }
        });
        $$( '.view_losses' ).forEach( ( item, index ) => {
            if ( !index ) {
                item.disabled = true;
                return;
            }
            item.onclick = e => {
                var state_id = e.target.getAttribute( "data-state_id" );
                var user = e.target.getAttribute( "data-user" );
                var losses = hedgehog_factory.state[ state_id ].admin_info_on_each_user[ user ].losses;
                var html = ``;
                losses.forEach( item => {
                    html = html + `
                        <div class="pnl_listing">
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Label</p>
                                <p>${item[ "label" ] || '[None]'}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Txhash</p>
                                <p>${item[ "txhash" ] || '[None]'}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Kind</p>
                                <p>${item[ "kind" ]}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Loss</p>
                                <p>${item[ "loss" ]} sats</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Description</p>
                                <p>${item[ "desc" ] || '[None]'}</p>
                            </div>
                            <div class="pnl_item">
                                <p style="font-weight: bold;">Time</p>
                                <p>${item[ "time" ]}</p>
                            </div>
                        </div>
                    `
                });
                showModal( html );
            }
        });
        $$( '.signer .progressBar' ).forEach( item => item.style.width = `100%` );
        $( '.validation_phase .progressBar' ).style.width = `100%`;
        setTimeout( () => {showPage( 'ejection_buttons' );}, 2000 );
        var sig_for_funding_tx = tapscript.Signer.taproot.sign( privkey, funding_tx, 0 );
        funding_tx.vin[ 0 ].witness = [ sig_for_funding_tx ];
        var funding_txid = tapscript.Tx.util.getTxid( funding_tx );
        var txhex = tapscript.Tx.encode( funding_tx ).hex;
        console.log( 'broadcast this:' );
        console.log( txhex );
        state.signing_finished = true;
        var funding_inputs_sum = 0;
        var funding_outputs_sum = 0;
        funding_tx.vin.forEach( vin => funding_inputs_sum = funding_inputs_sum + vin.prevout.value );
        funding_tx.vout.forEach( vout => funding_outputs_sum = funding_outputs_sum + vout.value );
        peers_to_message.forEach( user => {
            state.admin_info_on_each_user[ user ] = {
                losses: [],
                profits: [{
                    label: "funding",
                    txhash: null,
                    kind: "lightning",
                    gain: state.channel_cost,
                    desc: "",
                    time: Math.floor( Date.now() / 1000 ),
                }],
                balance: 0,
                last_active: Math.floor( Date.now() / 1000 ),
            }
            state.admin_info_on_each_user[ user ][ "losses" ].push({
                label: "funding",
                txhash: funding_txid,
                kind: "base layer",
                loss: Math.ceil( ( funding_inputs_sum - funding_outputs_sum ) / peers_to_message.length ),
                desc: `this funding transaction costed ${funding_inputs_sum - funding_outputs_sum} sats total and was divided among ${peers_to_message.length} users`,
                time: Math.floor( Date.now() / 1000 ),
            });
        });
        // Tell everyone their channels are active
        //send a message to each user and include the
        //signatures they need to unilaterally withdraw
        var i; for ( i=0; i<all_peers.length; i++ ) {
            if ( !i ) continue;
            var recipient = all_peers[ i ];
            var ejection_sigs_for_this_user = [];
            var connector_sigs_for_this_user = [];
            var j; for ( j=0; j<all_peers.length; j++ ) {
                ejection_sigs_for_this_user.push( sorted_user_ejection_sigs[ j ][ i ] );
                connector_sigs_for_this_user.push( sorted_connector_sigs[ j ][ i ] );
            }
            var msg = JSON.stringify({
                sorted_round_sigs,
                ejection_sigs_for_this_user,
                connector_sigs_for_this_user,
            });
            node.send( 'channels_active', msg, recipient, msg_id );
        }
    },
    ejectUser: ( user, state_id, i_am_admin = true ) => {
        if ( i_am_admin ) var conf = confirm( `Are you sure you want to eject this user from this channel factory?` );
        else var conf = confirm( `Are you sure you want to eject yourself from this channel factory?` );
        if ( !conf ) return;
        var state = hedgehog_factory.state[ state_id ];
        var round = state.current_round;
        var tree = state.tree;
        var backup_pubkey = state.backup_pubkey;
        var rounds = state.rounds;
        var sorted_round_sigs = state.sorted_round_sigs;
        var sorted_user_ejection_sigs = state.sorted_user_ejection_sigs;
        // console.log( 1, sorted_user_ejection_sigs );
        var sorted_connector_sigs = state.sorted_connector_sigs;
        var scripts = state.scripts;
        var address_type = state.address_type;
        var all_peers = state.all_peers;
        var average_bytesize_of_each_users_input = state.average_bytesize_of_each_users_input;
        var pubkey = state.pubkey;
        var privkey = state.privkey;
        var ejection_txs = state.ejection_txs;
        var midstate_scripts = state.midstate_scripts;
        var midstate_trees = state.midstate_trees;
        var tapleaf = tree[ 0 ];
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree });
        rounds[ round ].vin[ 0 ].witness = [ ...sorted_round_sigs[ round ].reverse(), scripts[ 0 ], cblock ];
        //to spend from the user's branch, get a utxo that you can pay the mining fee with
        var my_addy = tapscript.Address.fromScriptPubKey( [ 1, pubkey ], address_type );
        var fee_for_round = 2 * all_peers.length * average_bytesize_of_each_users_input;
        console.log( `please send ${fee_for_round} sats to this address:` );
        console.log( my_addy );
        var txid2 = prompt( `You are about to eject the user you selected. Please send ${fee_for_round} sats to the address in your console so that your user can pay the mining fee for their exit transaction, then enter the txid of your deposit` );
        var vout2 = Number( prompt( `and the vout` ) );
        var amnt2 = Number( prompt( `and the amount` ) );

        var round_fee_tx = tapscript.Tx.create({
            version: 3,
            vin: [{
                txid: tapscript.Tx.util.getTxid( rounds[ round ] ),
                vout: 0,
                prevout: rounds[ round ].vout[ 0 ],
            },{
                txid: txid2,
                vout: vout2,
                prevout: {
                    value: amnt2,
                    scriptPubKey: [ 1, pubkey ],
                }
            }],
            vout: [{
                value: ( all_peers.length * average_bytesize_of_each_users_input ) - 240,
                scriptPubKey: [ 1, pubkey ],
            }],
        });

        //sign for the input that pays the round fee
        var sig = tapscript.Signer.taproot.sign( privkey, round_fee_tx, 1 ).hex;
        round_fee_tx.vin[ 1 ].witness = [ sig ];

        var eject_user_tx = ejection_txs[ round ][ user ];
        if ( i_am_admin ) var eject_user_sigs = sorted_user_ejection_sigs[ round ][ user ].reverse();
        else var eject_user_sigs = sorted_user_ejection_sigs[ round ].reverse();
        if ( i_am_admin ) var my_connector_sigs = sorted_connector_sigs[ round ][ user ].reverse();
        else my_connector_sigs = sorted_connector_sigs[ round ].reverse();
        var tapleaf = midstate_trees[ round ][ user ];
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree: midstate_trees[ round ] });
        eject_user_tx.vin[ 0 ].witness = [ ...eject_user_sigs, midstate_scripts[ round ][ user ], cblock ];
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tree[ 0 ], tree: tree });
        eject_user_tx.vin[ 1 ].witness = [ ...my_connector_sigs, scripts[ 0 ], cblock ];

        var exit_fee_tx = tapscript.Tx.create({
            version: 3,
            vin: [{
                txid: tapscript.Tx.util.getTxid( eject_user_tx ),
                vout: 0,
                prevout: eject_user_tx.vout[ 0 ],
            },{
                txid: tapscript.Tx.util.getTxid( round_fee_tx ),
                vout: 0,
                prevout: round_fee_tx.vout[ 0 ],
            }],
            vout: [{
                value: 0,
                scriptPubKey: [ "OP_RETURN", "" ],
            }],
        });

        //sign for the input that pays the exit fee
        var sig = tapscript.Signer.taproot.sign( privkey, exit_fee_tx, 1 ).hex;
        exit_fee_tx.vin[ 1 ].witness = [ sig ];

        //show the admin the raw transaction hex for creating the midstate
        var txhex = tapscript.Tx.encode( rounds[ round ] ).hex;
        console.log( `broadcast this round_${round} tx that lets any user leave:` );
        console.log( txhex );

        //show the admin the raw transaction hex for paying the round fee
        var txhex = tapscript.Tx.encode( round_fee_tx ).hex;
        console.log( `broadcast this round_fee_tx tx that pays the fee for this round:` );
        console.log( txhex );
        console.log( `then wait for the round transaction and the round_fee_tx to confirm` );

        //show the admin the raw transaction hex for ejecting whoever they picked to eject
        var txhex = tapscript.Tx.encode( eject_user_tx ).hex;
        console.log( `broadcast this eject_user_tx that ejects the user you selected:` );
        console.log( txhex );

        //show the admin the raw transaction hex for paying the exit fee
        var txhex = tapscript.Tx.encode( exit_fee_tx ).hex;
        console.log( `broadcast this exit_fee_tx tx that pays the fee for the eject_user_tx:` );
        console.log( txhex );
        state.current_round = round + 1;
        if ( i_am_admin ) $$( '.eject_user_btn' )[ user ].disabled = true;
    },
    showWallet: async ( msg, state_id ) => {
        //TODO: have each user validate the sigs for their unilateral withdrawal
        state.signing_finished = true;
        state.sorted_round_sigs = JSON.parse( msg.dat )[ "sorted_round_sigs" ];
        state.sorted_user_ejection_sigs = JSON.parse( msg.dat )[ "ejection_sigs_for_this_user" ];
        state.sorted_connector_sigs = JSON.parse( msg.dat )[ "connector_sigs_for_this_user" ];
        $$( '.signer .progressBar' ).forEach( item => item.style.width = `100%` );
        $( '.validation_phase .progressBar' ).style.width = `100%`;
        await hedgehog_factory.waitSomeTime( 2_000 );
        showPage( 'wallet_page' );
        var hedgehog_chan_ids = [];
        var msg_id = state_id;
        state.opening_info_for_hedgehog_channels[ state.pubkey ].forEach( item => hedgehog_chan_ids.push( item.chan_id ) );
        $( '.send' ).setAttribute( "data-state_id", state_id );
        $( '.send' ).onclick = async e => {
            var state_id = e.target.getAttribute( "data-state_id" );
            var do_lightning = confirm( 'click ok to send via LN or cancel to send via hedgehog' );
            if ( !do_lightning ) {
                hedgehog_factory.sendViaHedgehog( state_id );
                return;
            }
            var invoice = prompt( `enter an ln invoice` );
            var htlc_hash = hedgehog.getInvoicePmthash( invoice );
            var amnt = hedgehog.getInvoiceAmount( invoice );
            if ( !amnt || !htlc_hash || amnt < 1 ) return alert( `error` );
            showModal( '<p>paying...</p>' );
            await hedgehog.aliceSendsHtlc( state_id, amnt, htlc_hash, invoice );
        }
        $( '.receive' ).setAttribute( "data-state_id", state_id );
        $( '.receive' ).onclick = async e => {
            var state_id = e.target.getAttribute( "data-state_id" );
            var do_lightning = confirm( 'click ok to receive via LN or cancel to receive via hedgehog' );
            if ( !do_lightning ) {
                hedgehog_factory.receiveViaHedgehog( state_id );
                return;
            }
            var amnt = Number( prompt( `enter an amount you want to receive` ) );
            if ( !amnt ) return;
            showModal( `<p>loading...</p>` );
            var state = hedgehog_factory.state[ state_id ];
            var all_peers = state.all_peers;
            var recipient = all_peers[ 0 ];
            var msg = JSON.stringify({
                type: "initiate_ln_receive",
                msg: {
                    amnt,
                    state_id,
                }
            });
            state.amount_alice_expects_in_next_htlc = amnt;
            var node = state.node;
            node.send( 'initiate_ln_receive', msg, recipient, msg_id );
        }
        $( '.eject' ).setAttribute( "data-state_id", state_id );
        $( '.eject' ).onclick = e => {
            var state_id = e.target.getAttribute( "data-state_id" );
            var round = Number( prompt( `enter what round we are in` ) );
            hedgehog_factory.state[ state_id ].current_round = round;
            hedgehog_factory.ejectUser( hedgehog_factory.state[ state_id ].all_peers.indexOf( hedgehog_factory.state[ state_id ].pubkey ), state_id, false );
        }
    },
    runGetRevData: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate the info sent by Bob
        //especially that the hash he ends up
        //sending matches the invoice you're
        //receiving with
        var state_id_according_to_bob = json.msg.state_id;
        if ( state_id_according_to_bob !== state_id ) return alert( `aborting because Bob prompted you to receive an htlc in a channel you do not have` );
        var amnt = json.msg.amnt;
        var state = hedgehog_factory.state[ state_id ];
        var expected_amnt = state.amount_alice_expects_in_next_htlc;
        if ( amnt !== expected_amnt ) return alert( `aborting because Bob tried to send you an amount other than the amount you asked for` );
        state.amount_alice_expects_in_next_htlc = 0;
        var invoice = null;
        if ( json.msg.hasOwnProperty( "invoice" ) ) invoice = json.msg.invoice;
        var secret = json.msg.secret;
        //if the user is receiving an LN payment, the following function
        //returns an LN invoice; otherwise it returns the boolean true 
        var invoice_to_receive_with = await hedgehog.aliceReceivesHTLC({amnt, secret, invoice, state_id});
        if ( invoice_to_receive_with && String( invoice_to_receive_with ).startsWith( "lnbc" ) ) {
            // console.log( "have someone pay this:" );
            // console.log( invoice_to_receive_with );
            var url = "lightning:" + invoice_to_receive_with;
            var a = document.createElement( "a" );
            a.href = url;
            a.target = "_blank";
            a.append( createQR( invoice_to_receive_with.toUpperCase() ) );
            var prep_div = document.createElement( "div" );
            prep_div.append( a );
            var div_html = prep_div.innerHTML;
            showModal( `<div style="max-width: 15rem; margin: auto;">${div_html}<div class="copy_box"><input class="copy_addy noselect" value="${invoice_to_receive_with}" disabled=""><span>&nbsp;</span><div class="copy_btn">⎘</div></div></div>` );
            $( '.copy_btn' ).onclick = () => {
                var copytext = $( '.copy_addy' );
                copytext.select();
                copytext.setSelectionRange( 0, 99999 );
                navigator.clipboard.writeText( copytext.value );
                showToast( 'copied' );
            }
        }
    },
    runInitiateLNReceive: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate that the state_id exists
        var state_id = json.msg.state_id;
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var nwc_string = state.nwc_string;
        var nwc_info = nwcjs.processNWCstring( nwc_string );
        // var chan_id = json.msg.chan_id;
        var amnt = Number( json.msg.amnt );
        if ( !amnt || amnt < 0 ) return 'error';
        //TODO: ensure you have outgoing capacity
        //TODO: ensure the user who sent you this request is your counterparty in the channel with this chan_id
        var delay_tolerance = 10;
        var desc = "";
        // console.log( 1 );
        var invoice_info = await nwcjs.makeInvoice( nwc_info, amnt, desc, delay_tolerance );
        // console.log( 2 );
        if ( invoice_info === "timed out" ) return alert( `you encountered an undefined error while processing this deposit request, try again:\n\n${JSON.stringify( invoice_info )}` );
        if ( "result_type" in invoice_info && invoice_info[ "result_type" ] !== "make_invoice" ) return alert( `your wallet encountered an undefined error while processing this deposit request, try again:\n\n${JSON.stringify( invoice_info )}` );
        if ( "error" in invoice_info && invoice_info[ "error" ] ) return alert( `error processing your deposit request: ${JSON.stringify( invoice_info[ "error" ] )} -- please try again` );
        var invoice = invoice_info.result.invoice || invoice_info.result.bolt11;
        var htlc_hash = hedgehog.getInvoicePmthash( invoice );
        // console.log( 3, msg_id, amnt, htlc_hash, invoice, msg.ctx.pubkey );
        hedgehog.bobSendsHtlc( msg_id, amnt, htlc_hash, invoice, msg.ctx.pubkey );
    },
    runInitiateHHReceive: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate that the state_id exists
        var state_id = json.msg.state_id;
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var amnt = Number( json.msg.amnt );
        if ( !amnt || amnt < 0 ) return 'error';
        //TODO: ensure you have outgoing capacity
        var htlc_hash = json.msg.hash;
        //TODO: ensure the hash for this request also matches one that is pending 
        //in the sender's channel
        hedgehog.bobSendsHtlc( msg_id, amnt, htlc_hash, null, msg.ctx.pubkey );
    },
    runInitiateLNPayment: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var msg_id = state_id;
        var info_from_alice = json.msg.info_for_bob;
        //validate that the state_id exists
        if ( info_from_alice.state_id !== state_id ) return;
        var state = hedgehog_factory.state[ state_id ];
        var nwc_string = state.nwc_string;
        var nwc_info = nwcjs.processNWCstring( nwc_string );
        var invoice_to_pay = json.msg.invoice_to_pay;
        var secret_for_responding_to_alice = json.msg.secret;
        var alices_pubkey = msg.ctx.pubkey;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ alices_pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var all_is_well = true;
        var invoice_to_pay = await hedgehog.bobReceivesHTLC( info_from_alice, secret_for_responding_to_alice, alices_pubkey, invoice_to_pay );
        if ( !invoice_to_pay.startsWith( "lnbc" ) ) all_is_well = false;
        if ( !all_is_well ) return alert( `abort, Alice sent you invalid invoice data` );
        if ( !hedgehog.getInvoiceAmount( invoice_to_pay ) ) return alert( `abort, Alice sent you an invoice with no amount` );
        var amnt = null;
        nwcjs.tryToPayInvoice( nwc_info, invoice_to_pay, amnt );
        //start listening for the payment to be successful, and when it is,
        //settle the pending htlc in your channels with Alice
        var loop = async () => {
            console.log( 'checking invoice status' );
            var delay_tolerance = 10;
            var invoice_status_info = await nwcjs.checkInvoice( nwc_info, invoice_to_pay, delay_tolerance );
            if ( invoice_status_info === "timed out" ) return alert( `you encountered an undefined error while processing this payment, try again:\n\n${JSON.stringify( invoice_status_info )}` );
            if ( "result_type" in invoice_status_info && invoice_status_info[ "result_type" ] !== "lookup_invoice" ) return alert( `your wallet encountered an undefined error while processing this payment, try again:\n\n${JSON.stringify( invoice_status_info )}` );
            if ( "error" in invoice_status_info && invoice_status_info[ "error" ] ) return alert( `error processing this payment, try again:\n\n${JSON.stringify( invoice_status_info[ "error" ] )}` );
            if ( invoice_status_info.result.settled_at ) {
                // $( '.expenses' ).innerText = Number( $( '.expenses' ).innerText ) + Math.floor( invoice_status_info.result.fees_paid / 1000 );
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    var pmt_status = await hedgehog.settleIncomingHTLC({ chan_id, preimage: invoice_status_info.result.preimage });
                    if ( !pmt_status.startsWith( "that went well" ) ) return alert( `something went wrong: ${pmt_status}` );
                }
                var msg = JSON.stringify({
                    type: "payment_succeeded",
                    msg: {
                        preimage: invoice_status_info.result.preimage,
                        state_id,
                    }
                });
                var fees_paid = Math.ceil( invoice_status_info.result.fees_paid / 1000 );
                hedgehog_factory.state[ state_id ].admin_info_on_each_user[ alices_pubkey ].losses.push({
                    label: "",
                    txhash: invoice_status_info.result.payment_hash,
                    kind: "lightning",
                    loss: fees_paid,
                    desc: ``,
                    time: Math.floor( Date.now() / 1000 ),
                });
                var recipient = alices_pubkey;
                var node = state.node;
                node.send( 'payment_succeeded', msg, recipient, msg_id );
                return;
            }
            var loop_delay = state.loop_delay;
            await super_nostr.waitSomeSeconds( loop_delay );
            return loop();
        }
        await loop();
    },
    runInitiateHHPayment: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var msg_id = state_id;
        var info_from_alice = json.msg.info_for_bob;
        //validate that the state_id exists
        if ( info_from_alice.state_id !== state_id ) return;
        var state = hedgehog_factory.state[ state_id ];
        var nwc_string = state.nwc_string;
        var nwc_info = nwcjs.processNWCstring( nwc_string );
        var secret_for_responding_to_alice = json.msg.secret;
        var alices_pubkey = msg.ctx.pubkey;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ alices_pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var all_is_well = await hedgehog.bobReceivesHTLC( info_from_alice, secret_for_responding_to_alice, alices_pubkey );
        if ( !all_is_well ) return alert( `abort, Alice sent you invalid htlc data` );
    },
    settleHedgehog: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate the state id and the preimage
        var provided_state_id = json.msg.state_id;
        if ( provided_state_id !== state_id ) return alert( `aborting because the admin sent you an invalid state id` );
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var preimage = json.msg.preimage;
        var sender = json.msg.sender;
        var recipient = msg.ctx.pubkey;
        //TODO: ensure the sender has a pending htlc for the same amount + payment hash
        var chan_ids = [];
        var opening_info = state.opening_info_for_hedgehog_channels[ recipient ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        //resolve the htlc
        var all_sigs_and_stuff = [];
        var i; for ( i=0; i<chan_ids.length; i++ ) {
            var chan_id = chan_ids[ i ];
            var sigs_and_stuff = await hedgehog.checkIfOutgoingHTLCIsSettled( chan_id, preimage );
            all_sigs_and_stuff.push( sigs_and_stuff );
        }
        var msg = JSON.stringify({
            type: "payment_complete",
            msg: {
                state_id,
                preimage,
                sigs_and_stuff: all_sigs_and_stuff,
            }
        });
        var node = state.node;
        node.send( 'payment_complete', msg, recipient, msg_id );
        //TODO: check if the sender is online before trying to settle with them
        var senders_chan_ids = [];
        opening_info = state.opening_info_for_hedgehog_channels[ sender ];
        opening_info.forEach( opener => senders_chan_ids.push( opener.chan_id ) );
        var k; for ( k=0; k<senders_chan_ids.length; k++ ) {
            var chan_id = senders_chan_ids[ k ];
            var pmt_status = await hedgehog.settleIncomingHTLC({ chan_id, preimage });
            if ( !String( pmt_status ).startsWith( "that went well" ) ) return alert( `something went wrong: ${pmt_status}` );
        }
        var msg = JSON.stringify({
            type: "payment_succeeded",
            msg: {
                preimage,
                state_id,
            }
        });
        node.send( 'payment_succeeded', msg, sender, msg_id );
    },
    runPaymentSucceeded: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate the state id and the preimage
        var provided_state_id = json.msg.state_id;
        if ( provided_state_id !== state_id ) return alert( `aborting because the admin sent you an invalid state id` );
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var preimage = json.msg.preimage;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ state.pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var all_sigs_and_stuff = [];
        var pending_htlc = JSON.parse( JSON.stringify( hedgehog.state[ chan_ids[ 0 ] ].pending_htlc ) );
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chan_id = chan_ids[ k ];
            //TODO: abort if the data is invalid
            var only_send_htlc_amount = true;
            var sigs_and_stuff = await hedgehog.checkIfOutgoingHTLCIsSettled( chan_id, preimage, only_send_htlc_amount );
            all_sigs_and_stuff.push( sigs_and_stuff );
        }
        // console.log( "send this data to your counterparty:" );
        // console.log( JSON.stringify( sigs_and_stuff ) );
        var recipient = msg.ctx.pubkey;
        var msg = JSON.stringify({
            type: "resolve_htlc",
            msg: {
                sigs_and_stuff: all_sigs_and_stuff,
            }
        });
        var node = state.node;
        node.send( 'resolve_htlc', msg, recipient, msg_id );
        if ( pending_htlc.hasOwnProperty( "bolt11" ) ) {
            var bolt11 = pending_htlc.bolt11;
            var pmthash_for_hedgehog = brick_wallet.getInvoicePmthash( bolt11 );
            var desc_for_hedgehog = brick_wallet.getInvoiceDescription( bolt11 );
            var amt_for_hedgehog = hedgehog.getInvoiceAmount( bolt11 );
            brick_wallet.state.history[ pmthash_for_hedgehog ] = {
                type: "outgoing",
                payment_hash: pmthash_for_hedgehog,
                invoice: bolt11,
                bolt11,
                description: desc_for_hedgehog,
                settled_at: Math.floor( Date.now() / 1000 ),
                fees_paid: 0,
                amount: amt_for_hedgehog * 1000,
                preimage,
                detail_hidden: true,
            }
            setTimeout( () => {
                modalVanish();
                var mybal = hedgehog.state[ chan_ids[ 0 ] ].balances[ 0 ];
                balance.setState( () => balance.bal = mybal );
                brick_wallet.parseHistory();
            }, 500 );
        }
    },
    runResolveHTLC: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var all_sigs_and_stuff = json.msg.sigs_and_stuff;
        //TODO: ensure the chan_ids being resolved belong to the user
        //and have pending htlcs
        var msg_id = state_id;
        var i; for ( i=0; i<all_sigs_and_stuff.length; i++ ) {
            var sigs_and_stuff = all_sigs_and_stuff[ i ];
            //TODO: consider more deeply whether I am right to assume it is safe to resolve an htlc
            //that is from Alice; my reasoning is that her htlcs always pay me more money, so resolving
            //them is fine; I don't even need to check that she has the right preimage or anything;
            //because resolving the htlc always results in me receiving more money
            var skip_pending_check = true;
            var chan_id = sigs_and_stuff[ "chan_id" ];
            if ( hedgehog.state[ chan_id ].pending_htlc && hedgehog.state[ chan_id ].pending_htlc.from !== "alice" ) return alert( 'it is unsafe to resolve this htlc' );
            hedgehog.receive( sigs_and_stuff, skip_pending_check );
            hedgehog.state[ chan_id ].pending_htlc = {}
        }
    },
    sendViaHedgehog: async state_id => {
        if ( !state_id ) return alert( `you forgot the state_id` );
        var amnt = Number( prompt( `enter how many sats you want to send` ) );
        if ( !amnt || amnt < 1 ) return alert( `error` );
        //TODO: ensure the amount is less than what you have
        var preimage = nobleSecp256k1.utils.randomPrivateKey();
        var htlc_hash = await hedgehog.sha256( preimage );
        preimage = hedgehog.bytesToHex( preimage );
        await hedgehog.aliceSendsHtlc( state_id, amnt, htlc_hash );
        showModal( `<p>Send this to your recipient:</p><p>{"preimage": "${preimage}", "admin": "whoever", "amnt": ${amnt}, "sender": "${hedgehog_factory.state[ state_id ].pubkey}"}</p>` );
        var state = hedgehog_factory.state[ state_id ];
        await hedgehog_factory.waitSomeTime( 1000 );
        var chan_id = state.opening_info_for_hedgehog_channels[ state.pubkey ][ 0 ].chan_id;
        var pending_htlc = hedgehog.state[ chan_id ].pending_htlc;
        var pmthash_for_hedgehog = pending_htlc.htlc_hash;
        var desc_for_hedgehog = "hedgehog payment";
        var amt_for_hedgehog = amnt;
        var loop = async () => {
            var pending_htlc = hedgehog.state[ chan_id ].pending_htlc;
            if ( !Object.keys( pending_htlc ).length ) {
                modalVanish();
                brick_wallet.state.history[ pmthash_for_hedgehog ] = {
                    type: "outgoing",
                    payment_hash: pmthash_for_hedgehog,
                    invoice: "none -- this was a hedghog payment",
                    bolt11: "none -- this was a hedghog payment",
                    description: desc_for_hedgehog,
                    settled_at: Math.floor( Date.now() / 1000 ),
                    fees_paid: 0,
                    amount: amt_for_hedgehog * 1000,
                    preimage,
                    detail_hidden: true,
                }
                var mybal = hedgehog.state[ hedgehog_factory.state[ state_id ].opening_info_for_hedgehog_channels[ hedgehog_factory.state[ state_id ].pubkey ][ 0 ].chan_id ].balances[ 0 ];
                balance.setState( () => balance.bal = mybal );
                brick_wallet.parseHistory();
                return;
            }
            await hedgehog_factory.waitSomeTime( 1000 );
            loop();
        }
        loop();
    },
    receiveViaHedgehog: async state_id => {
        var info_from_sender = prompt( `enter the info from the sender` );
        info_from_sender = JSON.parse( info_from_sender );
        if ( !info_from_sender ) return;
        var amnt = info_from_sender.amnt;
        //TODO: ensure the amount is less than your receiving capacity
        var preimage = info_from_sender.preimage;
        var hash = await hedgehog.sha256( hedgehog.hexToBytes( preimage ) );
        var sender = info_from_sender.sender;
        showModal( `<p>loading...</p>` );
        var state = hedgehog_factory.state[ state_id ];
        var all_peers = state.all_peers;
        var recipient = all_peers[ 0 ];
        var msg = JSON.stringify({
            type: "initiate_hh_receive",
            msg: {
                amnt,
                state_id,
                sender,
                hash,
            }
        });
        state.amount_alice_expects_in_next_htlc = amnt;
        state.pmthash_alice_expects_in_next_htlc = hash;
        var node = state.node;
        var msg_id = state_id;
        node.send( 'initiate_hh_receive', msg, recipient, msg_id );
        //run a loop to check if the htlc exists yet; when it exists,
        //send the preimage to the admin
        var loop = async () => {
            var chan_id = state.opening_info_for_hedgehog_channels[ state.pubkey ][ 0 ].chan_id;
            if ( Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length && hedgehog.state[ chan_id ].pending_htlc[ "htlc_hash" ] === hash ) {
                console.log( 'sending preimage to admin' );
                node.send( 'hh_preimage', JSON.stringify({msg: {preimage, sender, state_id}}), recipient, msg_id );
                return;
            }
            await hedgehog_factory.waitSomeTime( 1000 );
            loop();
        }
        loop();
    },
}
