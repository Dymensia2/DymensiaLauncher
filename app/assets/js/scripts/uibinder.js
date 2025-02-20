/**
 * Initialize UI functions which depend on internal modules.
 * Loaded after core UI functions are initialized in uicore.js.
 */
// Requirements
const path          = require('path')

const AuthManager   = require('./assets/js/authmanager')
const ConfigManager = require('./assets/js/configmanager')
const DistroManager = require('./assets/js/distromanager')
const Lang          = require('./assets/js/langloader')

let rscShouldLoad = false
let fatalStartupError = false

// Mapping of each view to their container IDs.
const VIEWS = {
    landing: '#landingContainer',
    login: '#loginContainer',
    settings: '#settingsContainer',
    welcome: '#welcomeContainer'
}

// The currently shown view container.
let currentView

/**
 * Switch launcher views.
 * 
 * @param {string} current The ID of the current view container. 
 * @param {*} next The ID of the next view container.
 * @param {*} currentFadeTime Optional. The fade out time for the current view.
 * @param {*} nextFadeTime Optional. The fade in time for the next view.
 * @param {*} onCurrentFade Optional. Callback function to execute when the current
 * view fades out.
 * @param {*} onNextFade Optional. Callback function to execute when the next view
 * fades in.
 */
function switchView(current, next, currentFadeTime = 250, nextFadeTime = 250, onCurrentFade = () => {}, onNextFade = () => {}){
    currentView = next
    $(`${current}`).fadeOut(currentFadeTime, () => {
        onCurrentFade()
        $(`${next}`).fadeIn(nextFadeTime, () => {
            onNextFade()
        })
    })
}

/**
 * Get the currently shown view container.
 * 
 * @returns {string} The currently shown view container.
 */
function getCurrentView(){
    return currentView
}

function showMainUI(data){

    if(!isDev){
        loggerAutoUpdater.log('Initializing...')
        ipcRenderer.send('autoUpdateAction', 'initAutoUpdater', ConfigManager.getAllowPrerelease())
    }

    setTimeout(() => {
        let loadingImage = document.getElementById('loadCenterImage')
        loadingImage.setAttribute('inflation', '')
        $('#loadingContainer').fadeOut(150, () => {
            loadingImage.removeAttribute('class')
            loadingImage.removeAttribute('inflation')
        })
    }, 0)

    prepareSettings(true)
    updateSelectedServer(data.getServer(ConfigManager.getSelectedServer()))
    refreshServerStatus()
    loadDiscord()
    setTimeout(() => {
        document.getElementById('frameBar').style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
        randomiseBackground()
        $('#main').show()

        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0

        // If this is enabled in a development environment we'll get ratelimited.
        // The relaunch frequency is usually far too high.
        validateSelectedAccount()

        if(ConfigManager.isFirstLaunch()){
            currentView = VIEWS.welcome
            $(VIEWS.welcome).fadeIn(100)
            if(hasRPC){
                DiscordWrapper.updateDetails('Bienvenue.')
                DiscordWrapper.updateState('Configuration du Launcher')
            }
        } else {
            if(isLoggedIn){
                currentView = VIEWS.landing
                $(VIEWS.landing).fadeIn(100)
                if(hasRPC && !ConfigManager.isFirstLaunch()){
                    if(ConfigManager.getSelectedServer()){
                        const serv = DistroManager.getDistribution().getServer(ConfigManager.getSelectedServer())
                        DiscordWrapper.updateDetails('Prêt à jouer!')
                        DiscordWrapper.updateState('Serveur: ' + serv.getName())
                    } else {
                        DiscordWrapper.updateDetails('Écran d’accueil...')
                    }
                }
            } else {
                currentView = VIEWS.login
                $(VIEWS.login).fadeIn(100)
                if(hasRPC){
                    DiscordWrapper.updateDetails('Ajoute un compte...')
                    DiscordWrapper.clearState()
                }
            }
        }
    }, 250)
    // Disable tabbing to the news container.
    initNews().then(() => {
        $('#newsContainer *').attr('tabindex', '-1')
    })
}

function showFatalStartupError(){
    setTimeout(() => {
        $('#loadingContainer').fadeOut(150, () => {
            document.getElementById('overlayContainer').style.background = 'none'
            setOverlayContent(
                'Erreur Fatale: Impossible de charger l’indice de distribution',
                'Aucune connexion n’a pu être établie avec nos serveurs pour télécharger l’index de distribution. Aucune copie locale n’était disponible pour le chargement. <br><br>L’index de distribution est un fichier essentiel qui fournit les dernières informations du serveur. Le launcher ne peut pas démarrer sans. Assurez-vous d’être connecté à Internet et relancez l’application. <br><br>Il est très possible que le launcher ait mis à jour et changé l’emplacement du fichier d’index de distribution. Nous vous recommandons d’installer la dernière version du lanceur à partir de notre page de versions. <br><br>Si vous continuez à avoir des problèmes, veuillez nous contacter sur le serveur Discord Dymensia..',
                'Télécharger la dernière version',
                'Rejoindre notre Discord'
            )
            setOverlayHandler(() => {
                shell.openExternal('https://github.com/dymensia/DymensiaLauncher/releases')
            })
            setDismissHandler(() => {
                shell.openExternal('https://discord.gg/dymensia')
            })
            toggleOverlay(true, true)
        })
    }, 750)
}

/**
 * Common functions to perform after refreshing the distro index.
 * 
 * @param {Object} data The distro index object.
 */
function onDistroRefresh(data){
    updateSelectedServer(data.getServer(ConfigManager.getSelectedServer()))
    refreshServerStatus()
    initNews()
    syncModConfigurations(data)
}

/**
 * Sync the mod configurations with the distro index.
 * 
 * @param {Object} data The distro index object.
 */
function syncModConfigurations(data){

    const syncedCfgs = []

    for(let serv of data.getServers()){

        const id = serv.getID()
        const mdls = serv.getModules()
        const cfg = ConfigManager.getModConfiguration(id)

        if(cfg != null){

            const modsOld = cfg.mods
            const mods = {}

            for(let mdl of mdls){
                const type = mdl.getType()

                if(type === DistroManager.Types.ForgeMod || type === DistroManager.Types.LiteMod || type === DistroManager.Types.LiteLoader){
                    if(!mdl.getRequired().isRequired()){
                        const mdlID = mdl.getVersionlessID()
                        if(modsOld[mdlID] == null){
                            mods[mdlID] = scanOptionalSubModules(mdl.getSubModules(), mdl)
                        } else {
                            mods[mdlID] = mergeModConfiguration(modsOld[mdlID], scanOptionalSubModules(mdl.getSubModules(), mdl), false)
                        }
                    } else {
                        if(mdl.hasSubModules()){
                            const mdlID = mdl.getVersionlessID()
                            const v = scanOptionalSubModules(mdl.getSubModules(), mdl)
                            if(typeof v === 'object'){
                                if(modsOld[mdlID] == null){
                                    mods[mdlID] = v
                                } else {
                                    mods[mdlID] = mergeModConfiguration(modsOld[mdlID], v, true)
                                }
                            }
                        }
                    }
                }
            }

            syncedCfgs.push({
                id,
                mods
            })

        } else {

            const mods = {}

            for(let mdl of mdls){
                const type = mdl.getType()
                if(type === DistroManager.Types.ForgeMod || type === DistroManager.Types.LiteMod || type === DistroManager.Types.LiteLoader){
                    if(!mdl.getRequired().isRequired()){
                        mods[mdl.getVersionlessID()] = scanOptionalSubModules(mdl.getSubModules(), mdl)
                    } else {
                        if(mdl.hasSubModules()){
                            const v = scanOptionalSubModules(mdl.getSubModules(), mdl)
                            if(typeof v === 'object'){
                                mods[mdl.getVersionlessID()] = v
                            }
                        }
                    }
                }
            }

            syncedCfgs.push({
                id,
                mods
            })

        }
    }

    ConfigManager.setModConfigurations(syncedCfgs)
    ConfigManager.save()
}

/**
 * Recursively scan for optional sub modules. If none are found,
 * this function returns a boolean. If optional sub modules do exist,
 * a recursive configuration object is returned.
 * 
 * @returns {boolean | Object} The resolved mod configuration.
 */
function scanOptionalSubModules(mdls, origin){
    if(mdls != null){
        const mods = {}

        for(let mdl of mdls){
            const type = mdl.getType()
            // Optional types.
            if(type === DistroManager.Types.ForgeMod || type === DistroManager.Types.LiteMod || type === DistroManager.Types.LiteLoader){
                // It is optional.
                if(!mdl.getRequired().isRequired()){
                    mods[mdl.getVersionlessID()] = scanOptionalSubModules(mdl.getSubModules(), mdl)
                } else {
                    if(mdl.hasSubModules()){
                        const v = scanOptionalSubModules(mdl.getSubModules(), mdl)
                        if(typeof v === 'object'){
                            mods[mdl.getVersionlessID()] = v
                        }
                    }
                }
            }
        }

        if(Object.keys(mods).length > 0){
            const ret = {
                mods
            }
            if(!origin.getRequired().isRequired()){
                ret.value = origin.getRequired().isDefault()
            }
            return ret
        }
    }
    return origin.getRequired().isDefault()
}

/**
 * Recursively merge an old configuration into a new configuration.
 * 
 * @param {boolean | Object} o The old configuration value.
 * @param {boolean | Object} n The new configuration value.
 * @param {boolean} nReq If the new value is a required mod.
 * 
 * @returns {boolean | Object} The merged configuration.
 */
function mergeModConfiguration(o, n, nReq = false){
    if(typeof o === 'boolean'){
        if(typeof n === 'boolean') return o
        else if(typeof n === 'object'){
            if(!nReq){
                n.value = o
            }
            return n
        }
    } else if(typeof o === 'object'){
        if(typeof n === 'boolean') return typeof o.value !== 'undefined' ? o.value : true
        else if(typeof n === 'object'){
            if(!nReq){
                n.value = typeof o.value !== 'undefined' ? o.value : true
            }

            const newMods = Object.keys(n.mods)
            for(let i=0; i<newMods.length; i++){

                const mod = newMods[i]
                if(o.mods[mod] != null){
                    n.mods[mod] = mergeModConfiguration(o.mods[mod], n.mods[mod])
                }
            }

            return n
        }
    }
    // If for some reason we haven't been able to merge,
    // wipe the old value and use the new one. Just to be safe
    return n
}

// function refreshDistributionIndex(remote, onSuccess, onError){
//     if(remote){
//         DistroManager.pullRemote()
//             .then(onSuccess)
//             .catch(onError)
//     } else {
//         DistroManager.pullLocal()
//             .then(onSuccess)
//             .catch(onError)
//     }
// }

async function validateSelectedAccount(){
    const selectedAcc = ConfigManager.getSelectedAccount()
    if(selectedAcc != null){
        const val = await AuthManager.validateSelected()
        if(!val){
            ConfigManager.removeAuthAccount(selectedAcc.uuid)
            ConfigManager.save()
            const accLen = Object.keys(ConfigManager.getAuthAccounts()).length
            setOverlayContent(
                'Failed to Refresh Login',
                `We were unable to refresh the login for <strong>${selectedAcc.displayName}</strong>. Please ${accLen > 0 ? 'select another account or ' : ''} login again.`,
                'Login',
                'Select Another Account'
            )
            setOverlayHandler(() => {
                document.getElementById('loginUsername').value = selectedAcc.username
                validateEmail(selectedAcc.username)
                loginViewOnSuccess = getCurrentView()
                loginViewOnCancel = getCurrentView()
                if(accLen > 0){
                    loginViewCancelHandler = () => {
                        ConfigManager.addAuthAccount(selectedAcc.uuid, selectedAcc.accessToken, selectedAcc.username, selectedAcc.displayName)
                        ConfigManager.save()
                        validateSelectedAccount()
                    }
                    loginCancelEnabled(true)
                }
                toggleOverlay(false)
                switchView(getCurrentView(), VIEWS.login)
                if(hasRPC){
                    DiscordWrapper.updateDetails('Ajoute un compte...')
                    DiscordWrapper.clearState()
                }
            })
            setDismissHandler(() => {
                if(accLen > 1){
                    prepareAccountSelectionList()
                    $('#overlayContent').fadeOut(150, () => {
                        bindOverlayKeys(true, 'accountSelectContent', true)
                        $('#accountSelectContent').fadeIn(150)
                    })
                } else {
                    const accountsObj = ConfigManager.getAuthAccounts()
                    const accounts = Array.from(Object.keys(accountsObj), v => accountsObj[v])
                    // This function validates the account switch.
                    setSelectedAccount(accounts[0].uuid)
                    toggleOverlay(false)
                }
            })
            toggleOverlay(true, accLen > 0)
        } else {
            return true
        }
    } else {
        return true
    }
}

/**
 * Temporary function to update the selected account along
 * with the relevent UI elements.
 * 
 * @param {string} uuid The UUID of the account.
 */
function setSelectedAccount(uuid){
    const authAcc = ConfigManager.setSelectedAccount(uuid)
    ConfigManager.save()
    updateSelectedAccount(authAcc)
    validateSelectedAccount()
}

// Synchronous Listener
document.addEventListener('readystatechange', function(){

    if (document.readyState === 'interactive' || document.readyState === 'complete'){
        if(rscShouldLoad){
            rscShouldLoad = false
            if(!fatalStartupError){
                const data = DistroManager.getDistribution()
                showMainUI(data)
            } else {
                showFatalStartupError()
            }
        } 
    }

}, false)

// Actions that must be performed after the distribution index is downloaded.
ipcRenderer.on('distributionIndexDone', (event, res) => {
    if(res) {
        const data = DistroManager.getDistribution()
        syncModConfigurations(data)
        if(document.readyState === 'interactive' || document.readyState === 'complete'){
            showMainUI(data)
        } else {
            rscShouldLoad = true
        }
    } else {
        fatalStartupError = true
        if(document.readyState === 'interactive' || document.readyState === 'complete'){
            showFatalStartupError()
        } else {
            rscShouldLoad = true
        }
    }
})

ipcRenderer.on('cachedDistributionNotification', (event, res) => {
    if(res) {
        setTimeout(() => {
            setOverlayContent(
                'Attention: Démarrage de la distribution en cache',
                'Nous n’avons pas été en mesure de récupérer les dernières informations du serveur sur internet au démarrage, nous avons donc utilisé une version précédemment stockée à la place.<br><br>Ce n’est pas recommandé, et vous devriez redémarrer votre client pour corriger cela afin d’éviter que vos fichiers modpack ne soient obsolètes. Si vous souhaitez continuer à utiliser le lanceur, vous pouvez réessayer à tout moment en appuyant sur le bouton de rafraîchissement de l’écran d’accueil.<br><br>Si cela continue de se produire, et vous n’êtes pas trop sûr pourquoi, venez nous voir sur Discord!',
                'Compris.',
                'Rejoindre notre Discord'
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            setDismissHandler(() => {
                shell.openExternal('https://discord.gg/dymensia')
            })
            toggleOverlay(true, true)
        }, 2000)
    }
})
