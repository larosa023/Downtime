use tauri::Manager;

/// The normal (non-mini) minimum width. The mini player is the only way the window gets narrower.
#[cfg(desktop)]
const NORMAL_MIN_WIDTH: f64 = 900.0;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Must be registered first: a second launch just focuses the running window.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
        // Remember size, position and maximized state. Visibility is handled below (the window
        // starts hidden to avoid a blank flash), and fullscreen always starts off.
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

                if let Some(window) = app.get_webview_window("main") {
                    // Fallback: the page shows the window after its first paint. If that never
                    // happens (a script error, a slow machine), show it anyway.
                    let w = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        if !w.is_visible().unwrap_or(true) {
                            let _ = w.show();
                        }
                    });

                    // Closing while in the mini player: don't let the tiny size become the size
                    // the app opens at next time. Hide, grow back to a normal size, then close.
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            let scale = w.scale_factor().unwrap_or(1.0);
                            let width = w.inner_size().map(|s| s.width as f64 / scale).unwrap_or(NORMAL_MIN_WIDTH);
                            if width + 0.5 < NORMAL_MIN_WIDTH {
                                api.prevent_close();
                                let w = w.clone();
                                std::thread::spawn(move || {
                                    let _ = w.hide();
                                    let _ = w.set_always_on_top(false);
                                    let _ = w.set_min_size(Some(tauri::LogicalSize::new(NORMAL_MIN_WIDTH, 620.0)));
                                    let _ = w.set_size(tauri::LogicalSize::new(1280.0, 820.0));
                                    let _ = w.center();
                                    std::thread::sleep(std::time::Duration::from_millis(100));
                                    {
                                        use tauri_plugin_window_state::AppHandleExt;
                                        let _ = w.app_handle().save_window_state(
                                            tauri_plugin_window_state::StateFlags::SIZE
                                                | tauri_plugin_window_state::StateFlags::POSITION
                                                | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                                        );
                                    }
                                    let _ = w.destroy();
                                });
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Downtime");
}
